import { MigrationInterface, QueryRunner } from 'typeorm';

export class OrganizationPlan1712920478545 implements MigrationInterface {
  name = 'OrganizationPlan1712920478545';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "organization_plan" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "segmentLimit" integer NOT NULL DEFAULT '0', "activeJourneyLimit" integer NOT NULL DEFAULT '0', "messageLimit" integer NOT NULL DEFAULT '0', "customerLimit" integer NOT NULL DEFAULT '0', "seatLimit" integer NOT NULL DEFAULT '0', "workspaceLimit" integer NOT NULL DEFAULT '0', "organizationId" uuid, CONSTRAINT "REL_21ae195d43ff98edcbedcae720" UNIQUE ("organizationId"), CONSTRAINT "PK_5057d4c67d87c89f2fa8d70196b" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(`ALTER TABLE "organization" ADD "planId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "organization" ADD CONSTRAINT "UQ_9838b0567dc51c15e3679b2a6e3" UNIQUE ("planId")`
    );
    await queryRunner.query(
      `ALTER TABLE "organization_plan" ADD CONSTRAINT "FK_21ae195d43ff98edcbedcae720e" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE`
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
      `ALTER TABLE "organization_plan" DROP CONSTRAINT "FK_21ae195d43ff98edcbedcae720e"`
    );
    await queryRunner.query(
      `ALTER TABLE "organization" DROP CONSTRAINT "UQ_9838b0567dc51c15e3679b2a6e3"`
    );
    await queryRunner.query(`ALTER TABLE "organization" DROP COLUMN "planId"`);
    await queryRunner.query(`DROP TABLE "organization_plan"`);
  }
}
