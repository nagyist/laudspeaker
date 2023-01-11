import {
  Injectable,
  Inject,
  LoggerService,
  HttpException,
} from '@nestjs/common';
import { Correlation, CustomersService } from '../customers/customers.service';
import { CustomerDocument } from '../customers/schemas/customer.schema';
import {
  EventsTable,
  CustomEventTable,
  JobTypes,
} from './interfaces/event.interface';
import { Account } from '../accounts/entities/accounts.entity';
import { PosthogBatchEventDto } from './dto/posthog-batch-event.dto';
import { EventDto } from './dto/event.dto';
import { AccountsService } from '../accounts/accounts.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { WorkflowTick } from '../workflows/interfaces/workflow-tick.interface';
import { PostHogEventDto } from './dto/posthog-event.dto';
import { StatusJobDto } from './dto/status-event.dto';
import { Queue } from 'bull';
import { InjectQueue } from '@nestjs/bull';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import mongoose, { Model } from 'mongoose';
import { EventDocument, Event } from './schemas/event.schema';
import mockData from '@/fixtures/mockData';
import { EventKeys, EventKeysDocument } from './schemas/event-keys.schema';
import { attributeConditions } from '@/fixtures/attributeConditions';
import keyTypes from '@/fixtures/keyTypes';
import defaultEventKeys from '@/fixtures/defaultEventKeys';
import {
  PosthogEventType,
  PosthogEventTypeDocument,
} from './schemas/posthog-event-type.schema';
import { AppDataSource } from '@/data-source';

@Injectable()
export class EventsService {
  constructor(
    @Inject(AccountsService) private readonly userService: AccountsService,
    @Inject(WorkflowsService)
    private readonly workflowsService: WorkflowsService,
    @Inject(CustomersService)
    private readonly customersService: CustomersService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
    @InjectQueue(JobTypes.email) private readonly emailQueue: Queue,
    @InjectQueue(JobTypes.slack) private readonly slackQueue: Queue,
    @InjectQueue(JobTypes.sms) private readonly smsQueue: Queue,
    @InjectModel(Event.name)
    private EventModel: Model<EventDocument>,
    @InjectModel(EventKeys.name)
    private EventKeysModel: Model<EventKeysDocument>,
    @InjectModel(PosthogEventType.name)
    private PosthogEventTypeModel: Model<PosthogEventTypeDocument>,
    @InjectConnection() private readonly connection: mongoose.Connection
  ) {
    for (const { name, property_type } of defaultEventKeys) {
      if (name && property_type) {
        this.EventKeysModel.updateOne(
          { key: name },
          { key: name, type: property_type, providerSpecific: 'posthog' },
          { upsert: true }
        ).exec();
      }
    }
  }

  async correlate(
    account: Account,
    ev: EventsTable
  ): Promise<CustomerDocument> {
    return this.customersService.findByExternalIdOrCreate(
      account,
      ev.userId ? ev.userId : ev.anonymousId
    );
  }

  async correlateCustomEvent(
    account: Account,
    ev: CustomEventTable
  ): Promise<Correlation> {
    return this.customersService.findByCustomEvent(account, ev.slackId);
  }

  async getJobStatus(body: StatusJobDto, type: JobTypes) {
    const jobQueues = {
      [JobTypes.email]: this.emailQueue,
      [JobTypes.slack]: this.slackQueue,
      [JobTypes.sms]: this.smsQueue,
    };

    try {
      const job = await jobQueues[type].getJob(body.jobId);
      const state = await job.getState();
      return state;
    } catch (err) {
      this.logger.error(`Error getting ${type} job status: ` + err);
      throw new HttpException(`Error getting ${type} job status`, 503);
    }
  }

  async getPostHogPayload(apiKey: string, body: PosthogBatchEventDto) {
    let account: Account, jobIds: WorkflowTick[]; // Account associated with the caller
    const transactionSession = await this.connection.startSession();
    transactionSession.startTransaction();
    const queryRunner = AppDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    // Step 1: Find corresponding account
    let jobArray: WorkflowTick[] = []; // created jobId
    try {
      account = await this.userService.findOneByAPIKey(apiKey.substring(8));
      this.logger.debug('Found account: ' + account.id);

      const chronologicalEvents: PostHogEventDto[] = body.batch.sort(
        (a, b) =>
          new Date(a.originalTimestamp).getTime() -
          new Date(b.originalTimestamp).getTime()
      );

      for (
        let numEvent = 0;
        numEvent < chronologicalEvents.length;
        numEvent++
      ) {
        const currentEvent = chronologicalEvents[numEvent];
        this.logger.debug(
          'Processing posthog event: ' + JSON.stringify(currentEvent, null, 2)
        );

        if (
          currentEvent.type === 'track' &&
          currentEvent.event &&
          currentEvent.event !== 'clicked'
        ) {
          const found = await this.PosthogEventTypeModel.findOne({
            name: currentEvent.event,
          })
            .session(transactionSession)
            .exec();
          if (!found) {
            await this.PosthogEventTypeModel.create(
              {
                name: currentEvent.event,
              },
              { session: transactionSession }
            );
          }
        }

        let jobIDs: WorkflowTick[] = [];
        //Step 2: Create/Correlate customer for each eventTemplatesService.queueMessage
        const postHogEventMapping = (event: any) => {
          const cust = {};
          if (event?.phPhoneNumber) {
            cust['phPhoneNumber'] = event.phPhoneNumber;
          }
          if (event?.phEmail) {
            cust['phEmail'] = event.phEmail;
          }
          if (event?.phCustom) {
            cust['phCustom'] = event.phCustom;
          }
          return cust;
        };

        const correlation = await this.customersService.findBySpecifiedEvent(
          account,
          'posthogId',
          currentEvent.userId,
          currentEvent,
          transactionSession,
          postHogEventMapping
        );

        if (!correlation.found) {
          await this.workflowsService.enrollCustomer(
            account,
            correlation.cust,
            queryRunner
          );
        }
        //need to change posthogeventdto to eventdo
        const convertedEventDto: EventDto = {
          correlationKey: 'posthogId',
          correlationValue: currentEvent.userId,
          event: currentEvent.context,
          source: 'posthog',
          payload: {
            type: currentEvent.type,
            event: currentEvent.event,
          },
        };

        //currentEvent
        jobIDs = await this.workflowsService.tick(
          account,
          convertedEventDto,
          queryRunner,
          transactionSession
        );
        this.logger.debug('Queued messages with jobIDs ' + jobIDs);
        jobArray = [...jobArray, ...jobIDs];
      }

      await transactionSession.commitTransaction();
      await queryRunner.commitTransaction();
    } catch (e) {
      await transactionSession.abortTransaction();
      await queryRunner.rollbackTransaction();
      this.logger.error('Error: ' + e);
      return new HttpException(e, 500);
    } finally {
      await transactionSession.endSession();
      await queryRunner.release();
    }
    return jobArray;
  }

  async enginePayload(apiKey: string, body: EventDto) {
    let account: Account, correlation: Correlation, jobIDs: WorkflowTick[];

    const transactionSession = await this.connection.startSession();
    transactionSession.startTransaction();
    const queryRunner = AppDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      account = await this.userService.findOneByAPIKey(apiKey.substring(8));
      if (!account) this.logger.error('Account not found');
      this.logger.debug('Found Account: ' + account.id);

      correlation = await this.customersService.findOrCreateByCorrelationKVPair(
        account,
        body,
        transactionSession
      );
      this.logger.debug('Correlation result:' + correlation.cust);

      if (!correlation.found)
        await this.workflowsService.enrollCustomer(
          account,
          correlation.cust,
          queryRunner
        );

      jobIDs = await this.workflowsService.tick(
        account,
        body,
        queryRunner,
        transactionSession
      );
      this.logger.debug('Queued messages with jobID ' + jobIDs);
      if (body) {
        await this.EventModel.create({
          ...body,
          createdAt: new Date().toUTCString(),
        });
      }

      await transactionSession.commitTransaction();
      await queryRunner.commitTransaction();
    } catch (err) {
      await transactionSession.abortTransaction();
      await queryRunner.rollbackTransaction();
      this.logger.error('Error: ' + err);
      return new HttpException(err, 500);
    } finally {
      await transactionSession.endSession();
      await queryRunner.release();
    }

    console.log(jobIDs);
    return jobIDs;
  }

  async getOrUpdateAttributes(resourceId: string) {
    const attributes = await this.EventKeysModel.find().exec();
    if (resourceId === 'attributes') {
      return {
        id: resourceId,
        nextResourceURL: 'attributeConditions',
        options: attributes.map((attribute) => ({
          label: attribute.key,
          id: attribute.key,
          nextResourceURL: attribute.key,
        })),
        type: 'select',
      };
    }

    const attribute = attributes.find(
      (attribute) => attribute.key === resourceId
    );
    if (attribute)
      return {
        id: resourceId,
        options: attributeConditions(attribute.type, attribute.isArray),
        type: 'select',
      };

    return (
      mockData.resources.find((resource) => resource.id === resourceId) || {}
    );
  }

  async getAttributes(resourceId: string, providerSpecific?: string) {
    const attributes = await this.EventKeysModel.find({
      key: RegExp(`.*${resourceId}.*`, 'i'),
      providerSpecific,
    })
      .limit(10)
      .exec();

    return attributes.map((el) => ({
      key: el.key,
      type: el.type,
      isArray: el.isArray,
      options: attributeConditions(el.type, el.isArray),
    }));
  }

  async getPossibleTypes() {
    return keyTypes;
  }

  async getPossibleComparisonTypes(type: string, isArray = false) {
    return attributeConditions(type, isArray);
  }

  async getPossibleValues(key: string, search: string) {
    const searchRegExp = new RegExp(`.*${search}.*`, 'i');
    const docs = await this.EventModel.aggregate([
      { $match: { [`event.${key}`]: searchRegExp } },
      { $group: { _id: `$event.${key}` } },
      { $limit: 5 },
    ]).exec();
    return docs.map((doc) => doc?.['event']?.[key]).filter((item) => item);
  }

  async getPossiblePosthogTypes(search = '') {
    const searchRegExp = new RegExp(`.*${search}.*`, 'i');
    const types = await this.PosthogEventTypeModel.find({
      name: searchRegExp,
    })
      .limit(10)
      .exec();
    return types.map((type) => type.name);
  }
}
