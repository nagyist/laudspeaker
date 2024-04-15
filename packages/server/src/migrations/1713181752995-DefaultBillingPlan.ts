import { OrganizationPlan } from '@/api/organizations/entities/organization-plan.entity';
import { Organization } from '@/api/organizations/entities/organization.entity';
import { MigrationInterface, QueryRunner } from 'typeorm';

const DEFAULT_PLAN: Partial<OrganizationPlan> = {
  segmentLimit: 100,
  activeJourneyLimit: 100,
  messageLimit: 100000000,
  customerLimit: 10000000,
  seatLimit: 100,
  workspaceLimit: 20,
};

export class DefaultBillingPlan1713181752995 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const organizationStream = await queryRunner.manager
      .createQueryBuilder(queryRunner)
      .addFrom(Organization, 'organization')
      .stream();

    for await (const organization of organizationStream) {
      if (organization.planId) continue;

      const { id: planId } = await queryRunner.manager.save(OrganizationPlan, {
        ...DEFAULT_PLAN,
      });

      await queryRunner.manager.save(Organization, {
        id: organization.id,
        plan: { id: planId },
      });
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {}
}
