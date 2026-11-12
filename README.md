# Together — shared expense app

Cross-platform monorepo: Next.js web, Expo mobile, NestJS API, shared TypeScript domain logic.

## Milestone 1 implemented
- Email/password signup and login with JWT sessions
- User profile endpoint
- Create and list groups
- Add existing users to groups by email
- Add expenses with one or more payers and equal or exact splits
- Group expense history and net member balances
- PostgreSQL persistence; integer paise storage

## Requirements
- Node.js 20+ (Node 22 LTS recommended)
- npm 10+
- Docker Desktop

## Local setup (Windows PowerShell)
1. Extract the ZIP and open the `splitwise-pro-alternative` folder in VS Code.
2. Install Node.js LTS and Docker Desktop if needed.
3. In the VS Code terminal, run `docker compose up -d`.
4. Copy `apps/api/.env.example` to `apps/api/.env`. For local use the defaults are okay; change JWT_SECRET before any deployment.
5. Run `npm install` from the repository root.
6. Run `npm run db:generate --workspace @expense/api`.
7. Run `npm run db:migrate --workspace @expense/api`.
8. Start the API in terminal 1: `npm run dev:api`.
9. Start the web app in terminal 2: `npm run dev:web`.
10. Open http://localhost:3000.

The API runs at http://localhost:4000/v1; health check: http://localhost:4000/v1/health.


## Multi-currency support (Milestone 9)
- Each group has a base currency selected when the group is created.
- Group expenses can be entered in a different currency using a manually supplied exchange rate.
- The exchange rate and converted base-currency amounts are stored with the expense, so later rate changes do not rewrite historical balances.
- Group balances, debt simplification, settlements, reminders and recurring expenses use the group's base currency.
- The first web UI offers INR, USD, EUR, GBP, AED, SGD, CAD, AUD and JPY.
- Direct friend-to-friend expenses remain INR-only in this milestone; mobile currency UI and automatic live exchange-rate feeds are not included yet.

## Important current limitations
- This is a development MVP, not production-ready. Before public deployment add email verification, password reset, rate limiting, stronger DTO validation, refresh-token/session management, invite links, audit events on every mutation, automated tests, secure CORS configuration and a proper secrets manager.
- Users can currently be added to groups by email only after they have registered.
- Expense creation supports equal split and explicit exact splits through the API. The first web form currently uses equal split.
- Balances show each member's net position (positive = owed, negative = owes). Settlement recording and debt simplification are the next milestone.
- UPI deep links and provider-side payment verification are not implemented yet.
- The Expo app is a starter shell; the current working milestone UI is the web app.
