import { Module, Controller, Get } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from './prisma.service';
import { AuthController, authProviders } from './auth/auth';
import { GroupsController, groupsProviders } from './groups/groups';
import { ExpensesController, BalancesController, expensesProviders } from './expenses/expenses';
import { UsersController, usersProviders } from './users/users';
import { SettlementsController, settlementsProviders } from './settlements/settlements';

@Controller('health') class HealthController { @Get() getHealth() { return { status: 'ok', service: 'together-api', version: '0.2.0' }; } }
@Module({ imports: [JwtModule.register({ secret: process.env.JWT_SECRET || 'local-dev-only-change-me', signOptions: { expiresIn: '7d' } })], controllers: [HealthController, AuthController, GroupsController, ExpensesController, BalancesController, SettlementsController, UsersController], providers: [PrismaService, ...authProviders, ...groupsProviders, ...expensesProviders, ...settlementsProviders, ...usersProviders] })
export class AppModule {}
