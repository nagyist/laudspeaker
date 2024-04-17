import {
  BaseEntity,
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Organization } from './organization.entity';

export const DEFAULT_PLAN: Partial<OrganizationPlan> = {
  segmentLimit: 100,
  activeJourneyLimit: 100,
  messageLimit: 100000000,
  customerLimit: 10000000,
  seatLimit: 100,
  workspaceLimit: 20,
};

@Entity()
export class OrganizationPlan extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  public id: string;

  @OneToOne(() => Organization, (organization) => organization.id, {
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
    nullable: false,
  })
  public organization: Organization;

  @Column({ default: DEFAULT_PLAN.segmentLimit })
  segmentLimit: number;

  @Column({ default: DEFAULT_PLAN.activeJourneyLimit })
  activeJourneyLimit: number;

  @Column({ default: DEFAULT_PLAN.messageLimit })
  messageLimit: number;

  @Column({ default: DEFAULT_PLAN.customerLimit })
  customerLimit: number;

  @Column({ default: DEFAULT_PLAN.seatLimit })
  seatLimit: number;

  @Column({ default: DEFAULT_PLAN.workspaceLimit })
  workspaceLimit: number;
}
