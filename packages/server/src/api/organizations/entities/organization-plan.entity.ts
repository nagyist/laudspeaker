import {
  BaseEntity,
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Organization } from './organization.entity';

@Entity()
export class OrganizationPlan extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  public id: string;

  @JoinColumn()
  @OneToOne(() => Organization, (organization) => organization.id, {
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  })
  public organization: Organization;

  @Column({ default: 0 })
  segmentLimit: number;

  @Column({ default: 0 })
  activeJourneyLimit: number;

  @Column({ default: 0 })
  messageLimit: number;

  @Column({ default: 0 })
  customerLimit: number;

  @Column({ default: 0 })
  seatLimit: number;

  @Column({ default: 0 })
  workspaceLimit: number;

  @Column({ nullable: true })
  organizationId: string;
}
