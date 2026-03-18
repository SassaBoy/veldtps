# NamPayroll 🇳🇦

**Namibian Payroll SaaS MVP** — Monthly payroll processing for small and medium businesses in Namibia (shops, guesthouses, farms, construction teams, etc.)

> ⚠️ **DISCLAIMER:** Payroll calculations are for guidance only. Always verify with NamRA and Social Security before final submission.

---

## Features

- **Company Registration & Authentication** — secure per-company accounts
- **Employee Management** — full CRUD with leave balance tracking
- **Monthly Payroll Processing** — run payroll in one click with full Namibian compliance
- **2026 NamRA PAYE Tax Brackets** — annualized income method, accurate to law
- **Social Security (SSC)** — 0.9% employee + employer, capped at N$99/month each
- **Employer Compensation Fund (ECF)** — configurable rate (default 4%)
- **PDF Payslips** — professional per-employee payslips via PDFKit
- **ZIP Download** — all payslips for a month in one click
- **Bank Transfer CSV** — FNB / Standard Bank compatible bulk payment file
- **Compliance Reports** — PAYE + SSC summary PDF and CSV for NamRA/Social Security
- **Employee Self-Service Portal** — employees view their own payslips and leave
- **Configurable Settings** — update ECF rate, SSC cap, overtime multiplier
- **Mobile-Friendly** — Bootstrap 5 responsive design

---

## Tech Stack

| Layer          | Technology                              |
|----------------|-----------------------------------------|
| Runtime        | Node.js (≥ 18)                          |
| Web Framework  | Express.js                              |
| Database       | MongoDB + Mongoose ODM                  |
| Views          | EJS templates                           |
| CSS Framework  | Bootstrap 5 (CDN)                       |
| Auth           | express-session + bcryptjs + connect-mongo |
| PDF Generation | PDFKit                                  |
| ZIP            | archiver                                |
| CSV            | csv-stringify                           |
| Other          | dotenv, express-validator, moment-timezone, express-flash, method-override |

---

## Prerequisites

- **Node.js** ≥ 18.0.0 — [nodejs.org](https://nodejs.org)
- **MongoDB** — local installation **or** a free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster

---

## Setup & Installation

### 1. Clone or download the project

```bash
git clone https://github.com/yourname/nampayroll.git
cd nampayroll
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env`:

```env
# MongoDB connection string
MONGO_URI=mongodb://localhost:27017/nampayroll
# or Atlas: mongodb+srv://user:password@cluster.mongodb.net/nampayroll

# Long random secret for sessions
SESSION_SECRET=replace_this_with_a_long_random_string

PORT=3000
NODE_ENV=development
```

### 4. Run the application

**Development (with auto-reload):**
```bash
npm run dev
```

**Production:**
```bash
npm start
```

### 5. Open in browser

```
http://localhost:3000
```

---

## First Steps After Launch

1. Go to `http://localhost:3000/register`
2. Register your company
3. Add employees under **Employees → Add Employee**
4. Set a portal password for each employee if they need self-service access
5. Go to **Payroll → Run Payroll**, select the month/year, enter days worked and overtime
6. Click **Run Payroll** — all calculations happen automatically
7. Download payslips (ZIP), bank transfer CSV, and compliance report PDF

---

## Project Structure

```
nampayroll/
├── server.js               # App entry point
├── config/
│   └── db.js               # MongoDB connection
├── models/
│   ├── User.js             # Company / admin account
│   ├── Employee.js         # Employee records
│   ├── PayrollRun.js       # Monthly payroll run + payslips
│   └── Settings.js         # Per-company rates (ECF, SSC, tax brackets)
├── routes/
│   ├── auth.js             # /login /register /logout
│   ├── dashboard.js        # /dashboard
│   ├── employees.js        # /employees CRUD
│   ├── payroll.js          # /payroll + downloads
│   ├── portal.js           # /portal (employee self-service)
│   └── settings.js         # /settings
├── controllers/            # Business logic (one per route file)
├── utils/
│   ├── payrollCalculator.js  # Core Namibian calculation engine
│   ├── pdfGenerator.js       # PDFKit payslip + compliance PDF
│   └── csvGenerator.js       # Bank CSV + compliance CSV
├── middleware/
│   └── auth.js             # Session guards
├── views/                  # EJS templates
│   ├── partials/           # header, navbar, footer
│   ├── auth/               # login, register
│   ├── dashboard/          # main dashboard
│   ├── employees/          # CRUD views
│   ├── payroll/            # run, view, history
│   ├── portal/             # employee self-service
│   └── settings/           # configuration
└── public/
    ├── css/style.css
    └── js/main.js
```

---

## Namibia PAYE Tax Calculation (2026)

Income is **annualized** (monthly gross × 12), then the bracket table is applied, then divided by 12 for the monthly PAYE.

| Annual Income (NAD)       | Tax                                         |
|---------------------------|---------------------------------------------|
| 0 – 100,000               | 0%                                          |
| 100,001 – 150,000         | 18% on amount above N$100,000               |
| 150,001 – 350,000         | N$9,000 + 25% above N$150,000               |
| 350,001 – 550,000         | N$59,000 + 28% above N$350,000              |
| 550,001 – 850,000         | N$115,000 + 30% above N$550,000             |
| 850,001 – 1,550,000       | N$205,000 + 32% above N$850,000             |
| Above 1,550,000           | N$429,000 + 37% above N$1,550,000           |

**SSC:** 0.9% of basic salary each (employee + employer), max N$99/month each (based on N$11,000 cap).

**ECF:** 4% of basic salary (employer only, configurable in Settings).

---

## Employee Portal

Employees log in at `/portal/login` using their email and the portal password set by the admin.

They can:
- View their leave balances (read-only)
- Download their own PDF payslips

---

## Updating Tax Brackets

Tax brackets are stored in the `Settings` collection in MongoDB. To update them in the future:

1. Connect to MongoDB
2. Find the company's settings document
3. Update the `taxBrackets` array

Or expose an admin UI (a natural next feature to build).

---

## Security Notes

- Passwords hashed with bcryptjs (12 salt rounds)
- Sessions stored in MongoDB via connect-mongo
- Employee portal is scoped — employees can only access their own data
- All admin routes require active session
- Use a strong `SESSION_SECRET` in production
- In production set `NODE_ENV=production` and `cookie.secure: true`

---

## Roadmap (Post-MVP)

- [ ] Email delivery of payslips
- [ ] UI editor for tax brackets
- [ ] Multi-currency support
- [ ] Payroll approval workflow
- [ ] Recurring allowances / deductions
- [ ] Annual leave accrual automation
- [ ] Audit log

---

## License

MIT — free for commercial use.

---

> ⚠️ **DISCLAIMER:** Payroll calculations are for guidance only. Always verify with NamRA and Social Security before final submission.
