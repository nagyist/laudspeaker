import {
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Workspaces } from './entities/workspaces.entity';
import { Repository } from 'typeorm';
import { Account } from '../accounts/entities/accounts.entity';
import { AccountsService } from '../accounts/accounts.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { OrganizationService } from '../organizations/organizations.service';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';

@Injectable()
export class WorkspacesService {
  constructor(
    private accountsService: AccountsService,
    private organizationService: OrganizationService,
    @InjectRepository(Workspaces)
    private workspacesRepository: Repository<Workspaces>
  ) {}

  public async getAllWorkspaces(account: Account) {
    account = await this.accountsService.accountsRepository.findOne({
      where: { id: account.id },
      relations: ['teams.organization.workspaces'],
    });

    return account.teams[0].organization.workspaces;
  }

  public async findOneByAPIKey(apiKey: string) {
    const workspace = await this.workspacesRepository.findOneBy({ apiKey });
    if (!workspace) throw new NotFoundException('Workspace not found');

    return workspace;
  }

  public async updateCurrentWorkspace(
    account: Account,
    updateWorkspaceDto: UpdateWorkspaceDto
  ) {
    if (!account.currentWorkspace)
      throw new NotFoundException('Workspace not found');

    await this.workspacesRepository.save({
      id: account.currentWorkspace.id,
      ...updateWorkspaceDto,
    });
  }

  public getCurrentWorkspace(account: Account) {
    return account.currentWorkspace;
  }

  public async setCurrentWorkspace(account: Account, id: string) {
    const workspaces = await this.getAllWorkspaces(account);

    const newCurrentWorkspace = workspaces.find(
      (workspace) => workspace.id === id
    );

    if (!newCurrentWorkspace)
      throw new NotFoundException('Workspace not found');

    await this.accountsService.accountsRepository.save({
      id: account.id,
      currentWorkspace: { id: newCurrentWorkspace.id },
    });
  }

  public async createWorkspace(
    account: Account,
    createWorkspaceDto: CreateWorkspaceDto
  ) {
    await this.workspacesRepository.save({
      name: createWorkspaceDto.name,
      organization: { id: account.teams[0].organization.id },
      apiKey: this.organizationService.authHelper.generateApiKey(),
    });
  }
}
