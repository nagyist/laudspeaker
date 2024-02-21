import {
  Processor,
  WorkerHost,
  InjectQueue,
  OnQueueEvent,
  QueueEventsListener,
  OnWorkerEvent,
} from '@nestjs/bullmq';
import { Job, Queue, UnrecoverableError } from 'bullmq';
import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { Correlation, CustomersService } from '../customers/customers.service';
import { DataSource } from 'typeorm';
import mongoose, { Model } from 'mongoose';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Journey } from '../journeys/entities/journey.entity';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import {
  PosthogEventType,
  PosthogEventTypeDocument,
} from './schemas/posthog-event-type.schema';
import { JourneysService } from '../journeys/journeys.service';
import { EventDto } from './dto/event.dto';
import {
  PosthogEvent,
  PosthogEventDocument,
} from './schemas/posthog-event.schema';
import { EventDocument } from './schemas/event.schema';
import {
  Customer,
  CustomerDocument,
} from '../customers/schemas/customer.schema';
import * as Sentry from '@sentry/node';
import { Account } from '../accounts/entities/accounts.entity';
import { EventType } from './events.processor';

export enum ProviderType {
  LAUDSPEAKER = 'laudspeaker',
  POSTHOG = 'posthog',
  WU_ATTRIBUTE = 'wu_attribute',
  MESSAGE = 'message',
}

@Injectable()
@Processor('events_pre', { removeOnComplete: { count: 100 } })
export class EventsPreProcessor extends WorkerHost {
  private providerMap: Record<
    ProviderType,
    (job: Job<any, any, string>) => Promise<void>
  > = {
    [ProviderType.LAUDSPEAKER]: async (job) => {
      await this.handleCustom(job);
    },
    [ProviderType.POSTHOG]: async (job) => {
      await this.handlePosthog(job);
    },
    [ProviderType.MESSAGE]: async (job) => {
      await this.handleMessage(job);
    },
    [ProviderType.WU_ATTRIBUTE]: async (job) => {
      await this.handleAttributeChange(job);
    },
  };

  constructor(
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: Logger,
    private dataSource: DataSource,
    @InjectConnection() private readonly connection: mongoose.Connection,
    @Inject(forwardRef(() => CustomersService))
    private readonly customersService: CustomersService,
    @Inject(forwardRef(() => JourneysService))
    private readonly journeysService: JourneysService,
    @InjectModel(Event.name)
    private eventModel: Model<EventDocument>,
    @InjectModel(PosthogEvent.name)
    private posthogEventModel: Model<PosthogEventDocument>,
    @InjectModel(PosthogEventType.name)
    private posthogEventTypeModel: Model<PosthogEventTypeDocument>,
    @InjectModel(Customer.name) public customerModel: Model<CustomerDocument>,
    @InjectQueue('events') private readonly eventsQueue: Queue
  ) {
    super();
  }

  log(message, method, session, user = 'ANONYMOUS') {
    this.logger.log(
      message,
      JSON.stringify({
        class: EventsPreProcessor.name,
        method: method,
        session: session,
        user: user,
      })
    );
  }
  debug(message, method, session, user = 'ANONYMOUS') {
    this.logger.debug(
      message,
      JSON.stringify({
        class: EventsPreProcessor.name,
        method: method,
        session: session,
        user: user,
      })
    );
  }
  warn(message, method, session, user = 'ANONYMOUS') {
    this.logger.warn(
      message,
      JSON.stringify({
        class: EventsPreProcessor.name,
        method: method,
        session: session,
        user: user,
      })
    );
  }
  error(error, method, session, user = 'ANONYMOUS') {
    this.logger.error(
      error.message,
      error.stack,
      JSON.stringify({
        class: EventsPreProcessor.name,
        method: method,
        session: session,
        cause: error.cause,
        name: error.name,
        user: user,
      })
    );
  }
  verbose(message, method, session, user = 'ANONYMOUS') {
    this.logger.verbose(
      message,
      JSON.stringify({
        class: EventsPreProcessor.name,
        method: method,
        session: session,
        user: user,
      })
    );
  }

  async process(job: Job<any, any, string>): Promise<any> {
    await this.providerMap[job.name](job);
  }

  async handlePosthog(job: Job<any, any, string>): Promise<any> {
    const transactionSession = await this.connection.startSession();
    transactionSession.startTransaction();
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    let err: any;

    // Step 1: Find corresponding account
    try {
      let customerFound = true;
      let postHogEvent = new PosthogEvent();
      try {
        postHogEvent = {
          ...postHogEvent,
          name: job.data.event.event,
          type: job.data.event.type,
          payload: JSON.stringify(job.data.event, null, 2),
          ownerId: job.data.account.id,
        };

        //update customer properties on every identify call as per best practice
        if (job.data.event.type === 'identify') {
          customerFound = await this.customersService.phIdentifyUpdate(
            job.data.account,
            job.data.event,
            transactionSession,
            job.data.session
          );
        }
        //checking for a custom tracked posthog event here
        if (
          job.data.event.type === 'track' &&
          job.data.event.event &&
          job.data.event.event !== 'change' &&
          job.data.event.event !== 'click' &&
          job.data.event.event !== 'submit' &&
          job.data.event.event !== '$pageleave' &&
          job.data.event.event !== '$rageclick'
        ) {
          //checks to see if we have seen this event before (otherwise we update the events dropdown)
          const found = await this.posthogEventTypeModel
            .findOne({
              name: job.data.event.event,
              ownerId: job.data.account.id,
            })
            .session(transactionSession)
            .exec();

          if (!found) {
            const res = await this.posthogEventTypeModel.create(
              {
                name: job.data.event.event,
                type: job.data.event.type,
                displayName: job.data.event.event,
                event: job.data.event.event,
                ownerId: job.data.account.id,
              },
              { session: transactionSession }
            );
          }
          //TODO: check if the event sets props, if so we need to update the person traits
        }
        //Step 2: Create/Correlate customer for each eventTemplatesService.queueMessage
        const postHogEventMapping = (event: any) => {
          const cust = {};
          if (event?.phPhoneNumber) {
            cust['phPhoneNumber'] = event.phPhoneNumber;
          }
          if (event?.phEmail) {
            cust['phEmail'] = event.phEmail;
          }
          if (event?.phDeviceToken) {
            cust['phDeviceToken'] = event.phDeviceToken;
          }
          if (event?.phCustom) {
            cust['phCustom'] = event.phCustom;
          }
          return cust;
        };

        const correlation = await this.customersService.findBySpecifiedEvent(
          job.data.account,
          'posthogId',
          [job.data.event.userId, job.data.event.anonymousId],
          job.data.event,
          transactionSession,
          job.data.session,
          postHogEventMapping
        );

        if (!correlation.found || !customerFound) {
          await this.journeysService.enrollCustomer(
            job.data.account,
            correlation.cust,
            queryRunner,
            transactionSession,
            job.data.session
          );
        }
        //need to change posthogeventdto to eventdo
        const convertedEventDto: EventDto = {
          correlationKey: 'posthogId',
          correlationValue: [job.data.event.userId, job.data.event.anonymousId],
          event: job.data.event.event,
          source: 'posthog',
          payload: {
            type: job.data.event.type,
            context: job.data.event.context,
          },
        };

        const workspace =
          job.data.account.teams?.[0]?.organization?.workspaces?.[0];

        const journeys = await queryRunner.manager.find(Journey, {
          where: {
            workspace: {
              id: workspace.id,
            },
            isActive: true,
            isPaused: false,
            isStopped: false,
            isDeleted: false,
          },
        });
        for (let i = 0; i < journeys.length; i++) {
          await this.eventsQueue.add(
            'event',
            {
              accountID: job.data.account.id,
              event: convertedEventDto,
              journeyID: journeys[i].id,
            },
            {
              attempts: 1,
            }
          );
        }
      } catch (e) {
        if (e instanceof Error) {
          postHogEvent.errorMessage = e.message;
          err = e;
        }
        this.error(
          e,
          this.handlePosthog.name,
          job.data.session,
          job.data.account.id
        );
      } finally {
        await this.posthogEventModel.create(postHogEvent);
      }
      if (err) throw err;

      await transactionSession.commitTransaction();
      await queryRunner.commitTransaction();
    } catch (e) {
      await transactionSession.abortTransaction();
      await queryRunner.rollbackTransaction();
      err = e;
    } finally {
      await transactionSession.endSession();
      await queryRunner.release();
    }

    if (err?.code === 11000) {
      this.warn(
        `${JSON.stringify({
          warning: 'Attempting to insert a duplicate key!',
        })}`,
        this.handlePosthog.name,
        job.data.session,
        job.data.account.id
      );
      throw err;
    } else if (err) {
      this.error(
        err,
        this.handlePosthog.name,
        job.data.session,
        job.data.account.id
      );
      throw new UnrecoverableError();
    }
  }

  async handleCustom(job: Job<any, any, string>): Promise<any> {
    const transactionSession = await this.connection.startSession();
    transactionSession.startTransaction();
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    let err: any;

    try {
      //finding the owner of th workspace for the event
      const owner = await queryRunner.manager.findOne(Account, {
        where: { id: job.data.account.id },
        relations: ['teams.organization.workspaces'],
      });
      const workspace = owner.teams?.[0]?.organization?.workspaces?.[0];

      //find customer associated with event or create new customer if not found
      const correlation: Correlation =
        await this.customersService.findOrCreateByCorrelationKVPair(
          owner,
          job.data.event,
          transactionSession
        );

      //enroll new customers in journeys that might be to relevant to them (but not existing customers)
      await this.journeysService.enrollCustomer(
        owner,
        correlation.cust,
        queryRunner,
        transactionSession,
        job.data.session
      );

      //get all the journeys that are active, and pipe events to each journey in case they are listening for event
      const journeys = await queryRunner.manager.find(Journey, {
        where: {
          workspace: {
            id: workspace.id,
          },
          isActive: true,
          isPaused: false,
          isStopped: false,
          isDeleted: false,
        },
      });
      for (let i = 0; i < journeys.length; i++) {
        await this.eventsQueue.add(
          EventType.EVENT,
          {
            accountID: job.data.account.id,
            event: job.data.event,
            journeyID: journeys[i].id,
          },
          {
            attempts: Number.MAX_SAFE_INTEGER,
            backoff: { type: 'fixed', delay: 1000 },
          }
        );
      }
      // add event to event database for visibility
      if (job.data.event) {
        await this.eventModel.create({
          ...job.data.event,
          workspaceId: workspace.id,
          //we should really standardize on .toISOString() or .toUTCString()
          //createdAt: new Date().toUTCString(),
          createdAt: new Date().toISOString(),
        });
      }

      await transactionSession.commitTransaction();
      await queryRunner.commitTransaction();
    } catch (e) {
      await transactionSession.abortTransaction();
      await queryRunner.rollbackTransaction();
      this.error(e, this.handleCustom.name, job.data.session, job.data.account);
      err = e;
    } finally {
      await transactionSession.endSession();
      await queryRunner.release();
    }
    if (err?.code === 11000) {
      this.warn(
        `${JSON.stringify({
          warning: 'Attempting to insert a duplicate key!',
        })}`,
        this.handleCustom.name,
        job.data.session,
        job.data.account.id
      );
      throw err;
    } else if (err) {
      this.error(
        err,
        this.handleCustom.name,
        job.data.session,
        job.data.account.id
      );
      throw err;
    }
  }

  async handleMessage(job: Job<any, any, string>): Promise<any> {
    const transactionSession = await this.connection.startSession();
    transactionSession.startTransaction();
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let err: any;

    try {
      const journeys = await queryRunner.manager.find(Journey, {
        where: {
          workspace: {
            id: job.data.workspaceId,
          },
          isActive: true,
          isPaused: false,
          isStopped: false,
          isDeleted: false,
        },
      });
      for (let i = 0; i < journeys.length; i++) {
        await this.eventsQueue.add(
          EventType.MESSAGE,
          {
            workspaceId: job.data.workspaceId,
            message: job.data.message,
            customer: job.data.customer,
            journeyID: journeys[i].id,
          },
          {
            attempts: Number.MAX_SAFE_INTEGER,
            backoff: { type: 'fixed', delay: 1000 },
          }
        );
      }

      await transactionSession.commitTransaction();
      await queryRunner.commitTransaction();
    } catch (e) {
      await transactionSession.abortTransaction();
      await queryRunner.rollbackTransaction();
      this.error(
        e,
        this.handleMessage.name,
        job.data.session,
        job.data.accountID
      );
      err = e;
    } finally {
      await transactionSession.endSession();
      await queryRunner.release();
    }
    if (err) {
      this.error(
        err,
        this.handleMessage.name,
        job.data.session,
        job.data.accountID
      );
      throw err;
    }
  }

  async handleAttributeChange(job: Job<any, any, string>): Promise<any> {
    const transactionSession = await this.connection.startSession();
    transactionSession.startTransaction();
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let err: any;

    try {
      const journeys = await queryRunner.manager.find(Journey, {
        where: {
          workspace: {
            id: job.data.workspaceId,
          },
          isActive: true,
          isPaused: false,
          isStopped: false,
          isDeleted: false,
        },
      });
      for (let i = 0; i < journeys.length; i++) {
        if (job.data.message.operationType === 'update') {
          await this.eventsQueue.add(
            EventType.ATTRIBUTE,
            {
              accountID: job.data.account.id,
              customer: job.data.message.documentKey._id['$oid'],
              fields: job.data.message.updateDescription?.updatedFields,
              journeyID: journeys[i].id,
            },
            {
              attempts: Number.MAX_SAFE_INTEGER,
              backoff: { type: 'fixed', delay: 1000 },
            }
          );
        }
      }

      await transactionSession.commitTransaction();
      await queryRunner.commitTransaction();
    } catch (e) {
      await transactionSession.abortTransaction();
      await queryRunner.rollbackTransaction();
      this.error(
        e,
        this.handleAttributeChange.name,
        job.data.session,
        job.data.account
      );
      err = e;
    } finally {
      await transactionSession.endSession();
      await queryRunner.release();
    }
    if (err) {
      this.error(
        err,
        this.handleAttributeChange.name,
        job.data.session,
        job.data.account.id
      );
      throw err;
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job, error: Error, prev?: string) {
    Sentry.withScope((scope) => {
      scope.setTag('job_id', job.id);
      scope.setTag('processor', EventsPreProcessor.name);
      Sentry.captureException(error);
    });
  }
}
