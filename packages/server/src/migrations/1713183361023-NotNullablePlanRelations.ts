import { MigrationInterface, QueryRunner } from 'typeorm';

export class NotNullablePlanRelations1713183361023
  implements MigrationInterface
{
  name = 'NotNullablePlanRelations1713183361023';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "organization_plan" DROP CONSTRAINT "FK_21ae195d43ff98edcbedcae720e"`
    );
    await queryRunner.query(
      `ALTER TABLE "organization_plan" DROP CONSTRAINT "REL_21ae195d43ff98edcbedcae720"`
    );
    await queryRunner.query(
      `ALTER TABLE "organization_plan" DROP COLUMN "organizationId"`
    );
    await queryRunner.query(
      `ALTER TABLE "organization" DROP CONSTRAINT "FK_9838b0567dc51c15e3679b2a6e3"`
    );
    await queryRunner.query(
      `ALTER TABLE "organization" ALTER COLUMN "planId" SET NOT NULL`
    );
    await queryRunner.query(
      `ALTER TABLE "organization" ADD CONSTRAINT "FK_9838b0567dc51c15e3679b2a6e3" FOREIGN KEY ("planId") REFERENCES "organization_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "organization" DROP CONSTRAINT "FK_9838b0567dc51c15e3679b2a6e3"`
    );
    await queryRunner.query(
      `ALTER TABLE "organization" ALTER COLUMN "planId" DROP NOT NULL`
    );
    await queryRunner.query(
      `ALTER TABLE "organization" ADD CONSTRAINT "FK_9838b0567dc51c15e3679b2a6e3" FOREIGN KEY ("planId") REFERENCES "organization_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE`
    );
    await queryRunner.query(
      `ALTER TABLE "organization_plan" ADD "organizationId" uuid`
    );
    await queryRunner.query(
      `ALTER TABLE "organization_plan" ADD CONSTRAINT "REL_21ae195d43ff98edcbedcae720" UNIQUE ("organizationId")`
    );
    await queryRunner.query(
      `ALTER TABLE "organization_plan" ADD CONSTRAINT "FK_21ae195d43ff98edcbedcae720e" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE`
    );
  }
}
