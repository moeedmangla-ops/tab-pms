-- CreateEnum
CREATE TYPE "public"."RoleKey" AS ENUM ('MANAGING_PARTNER', 'PARTNER', 'MANAGER', 'SENIOR_ACCOUNTANT', 'ACCOUNTANT', 'TAX_CONSULTANT', 'AUDIT_STAFF', 'BUSINESS_DEVELOPMENT', 'ADMINISTRATOR', 'READ_ONLY');

-- CreateEnum
CREATE TYPE "public"."ClientStatus" AS ENUM ('PROSPECT', 'ACTIVE', 'ON_HOLD', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "public"."EntityType" AS ENUM ('LLC', 'FREE_ZONE_COMPANY', 'FREE_ZONE_ESTABLISHMENT', 'SOLE_ESTABLISHMENT', 'BRANCH', 'CIVIL_COMPANY', 'PUBLIC_JSC', 'PRIVATE_JSC', 'NATURAL_PERSON', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."FilingFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'ANNUAL', 'NOT_REGISTERED');

-- CreateEnum
CREATE TYPE "public"."ServiceLine" AS ENUM ('VAT', 'CORPORATE_TAX', 'BOOKKEEPING', 'AUDIT', 'TRANSFER_PRICING', 'TAX_ADVISORY', 'BUSINESS_SETUP', 'OUTSOURCED_CFO');

-- CreateEnum
CREATE TYPE "public"."BillingFrequency" AS ENUM ('ONE_OFF', 'MONTHLY', 'QUARTERLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "public"."ObligationType" AS ENUM ('VAT_RETURN', 'CT_RETURN', 'TRADE_LICENCE_RENEWAL', 'ENGAGEMENT_RENEWAL', 'AUDIT_REPORT', 'TP_LOCAL_FILE', 'TAX_PAYMENT', 'DOCUMENT_EXPIRY', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."RuleBasis" AS ENUM ('DAYS_AFTER_PERIOD_END', 'MONTHS_AFTER_PERIOD_END', 'ON_SOURCE_DATE');

-- CreateEnum
CREATE TYPE "public"."ObligationStatus" AS ENUM ('UPCOMING', 'DOCUMENTS_REQUESTED', 'DOCUMENTS_RECEIVED', 'IN_PREPARATION', 'PENDING_INTERNAL_REVIEW', 'PENDING_CLIENT_APPROVAL', 'READY_FOR_SUBMISSION', 'SUBMITTED', 'PAYMENT_PENDING', 'COMPLETED', 'ON_HOLD');

-- CreateEnum
CREATE TYPE "public"."PaymentStatus" AS ENUM ('NOT_APPLICABLE', 'UNPAID', 'PAID', 'WAIVED');

-- CreateEnum
CREATE TYPE "public"."ReminderTrack" AS ENUM ('INTERNAL_PREPARER', 'INTERNAL_REVIEWER', 'MANAGER_ESCALATION', 'PARTNER_ESCALATION', 'CLIENT_DOCUMENT_REQUEST', 'CLIENT_APPROVAL_REQUEST', 'PAYMENT_FOLLOW_UP', 'LEAD_FOLLOW_UP', 'TASK_ESCALATION', 'DAILY_DIGEST', 'WEEKLY_PARTNER_SUMMARY');

-- CreateEnum
CREATE TYPE "public"."ReminderTrigger" AS ENUM ('BEFORE_STATUTORY', 'OVERDUE_REPEAT', 'AT_PREP_DEADLINE', 'BEFORE_STATUTORY_OPEN');

-- CreateEnum
CREATE TYPE "public"."DeliveryStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'SKIPPED_PAUSED', 'REDIRECTED_TEST');

-- CreateEnum
CREATE TYPE "public"."LeadStage" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL_SENT', 'NEGOTIATION', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "public"."LeadSource" AS ENUM ('WEBSITE_FORM', 'REFERRAL', 'BNI', 'LINKEDIN', 'WALK_IN', 'FREE_ZONE_REFERRAL', 'EXISTING_CLIENT', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."CommChannel" AS ENUM ('EMAIL', 'PHONE', 'WHATSAPP', 'MEETING', 'SITE_VISIT');

-- CreateEnum
CREATE TYPE "public"."CommDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'INTERNAL');

-- CreateEnum
CREATE TYPE "public"."TaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."Priority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "public"."DocumentType" AS ENUM ('TRADE_LICENCE', 'CERT_OF_INCORPORATION', 'MOA', 'VAT_CERTIFICATE', 'CT_CERTIFICATE', 'ENGAGEMENT_LETTER', 'SIGNED_FINANCIAL_STATEMENTS', 'FILED_RETURN', 'SUBMISSION_ACK', 'BANK_LETTER', 'EMIRATES_ID', 'PASSPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."InvoiceStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');

-- CreateTable
CREATE TABLE "public"."Role" (
    "id" TEXT NOT NULL,
    "key" "public"."RoleKey" NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Permission" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."role_permission" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "role_permission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "public"."user" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "managerId" TEXT,
    "passwordHash" TEXT,
    "totpSecret" TEXT,
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "entraObjectId" TEXT,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ,
    "lastLoginAt" TIMESTAMPTZ,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "onLeaveFrom" DATE,
    "onLeaveTo" DATE,
    "weeklyCapacityHrs" INTEGER NOT NULL DEFAULT 40,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "ip" TEXT,
    "revokedAt" TIMESTAMPTZ,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."client" (
    "id" TEXT NOT NULL,
    "clientCode" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "tradeName" TEXT,
    "entityType" "public"."EntityType" NOT NULL DEFAULT 'LLC',
    "licenceNumber" TEXT,
    "licenceAuthority" TEXT,
    "licenceExpiry" DATE,
    "emirate" TEXT,
    "jurisdiction" TEXT NOT NULL DEFAULT 'AE',
    "industry" TEXT,
    "status" "public"."ClientStatus" NOT NULL DEFAULT 'ACTIVE',
    "fyEndMonth" INTEGER,
    "fyEndDay" INTEGER,
    "relationshipPartnerId" TEXT,
    "stopWork" BOOLEAN NOT NULL DEFAULT false,
    "stopWorkReason" TEXT,
    "notes" TEXT,
    "searchText" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."client_tax_profile" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "vatTrn" TEXT,
    "vatEffectiveDate" DATE,
    "vatFrequency" "public"."FilingFrequency" NOT NULL DEFAULT 'NOT_REGISTERED',
    "vatPeriodAnchor" DATE,
    "ctRegistrationNo" TEXT,
    "ctRegistered" BOOLEAN NOT NULL DEFAULT false,
    "ctFirstPeriodStart" DATE,
    "freeZone" BOOLEAN NOT NULL DEFAULT false,
    "qfzpStatus" BOOLEAN NOT NULL DEFAULT false,
    "smallBusinessRelief" BOOLEAN NOT NULL DEFAULT false,
    "taxGroupName" TEXT,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "client_tax_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."contact" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "designation" TEXT,
    "email" TEXT,
    "mobile" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isAccounts" BOOLEAN NOT NULL DEFAULT false,
    "isAuthorisedSignatory" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."service_engagement" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "serviceLine" "public"."ServiceLine" NOT NULL,
    "fee" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "billingFrequency" "public"."BillingFrequency" NOT NULL DEFAULT 'ANNUAL',
    "contractStart" DATE NOT NULL,
    "contractEnd" DATE,
    "partnerId" TEXT,
    "managerId" TEXT,
    "preparerId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "service_engagement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."deadline_rule" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "jurisdiction" TEXT NOT NULL DEFAULT 'AE',
    "obligationType" "public"."ObligationType" NOT NULL,
    "name" TEXT NOT NULL,
    "basis" "public"."RuleBasis" NOT NULL,
    "offsetDays" INTEGER NOT NULL DEFAULT 0,
    "offsetMonths" INTEGER NOT NULL DEFAULT 0,
    "prepLeadWorkingDays" INTEGER NOT NULL DEFAULT 10,
    "reviewLeadWorkingDays" INTEGER NOT NULL DEFAULT 5,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "notes" TEXT,
    "isConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deadline_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."obligation" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "engagementId" TEXT,
    "type" "public"."ObligationType" NOT NULL,
    "title" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "statutoryDueDate" DATE NOT NULL,
    "internalTargetDate" DATE NOT NULL,
    "prepDeadline" DATE NOT NULL,
    "reviewDeadline" DATE NOT NULL,
    "status" "public"."ObligationStatus" NOT NULL DEFAULT 'UPCOMING',
    "onHoldReason" TEXT,
    "preparerId" TEXT,
    "reviewerId" TEXT,
    "ruleId" TEXT,
    "ruleVersion" INTEGER,
    "isManualOverride" BOOLEAN NOT NULL DEFAULT false,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "needsReviewReason" TEXT,
    "reviewerConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "submissionReference" TEXT,
    "submissionDate" TIMESTAMPTZ,
    "amountPayable" DECIMAL(14,2),
    "paymentStatus" "public"."PaymentStatus" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "waiverReason" TEXT,
    "lastChangedById" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "obligation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."obligation_status_history" (
    "id" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "fromStatus" "public"."ObligationStatus",
    "toStatus" "public"."ObligationStatus" NOT NULL,
    "changedById" TEXT,
    "changedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "obligation_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."obligation_type_setting" (
    "type" "public"."ObligationType" NOT NULL,
    "enabledStatuses" "public"."ObligationStatus"[],
    "prepLeadWorkingDays" INTEGER NOT NULL DEFAULT 10,
    "reviewLeadWorkingDays" INTEGER NOT NULL DEFAULT 5,
    "remindersEnabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "obligation_type_setting_pkey" PRIMARY KEY ("type")
);

-- CreateTable
CREATE TABLE "public"."holiday" (
    "id" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL DEFAULT 'AE',
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "isConfirmed" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."reminder_rule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "obligationType" "public"."ObligationType",
    "track" "public"."ReminderTrack" NOT NULL,
    "trigger" "public"."ReminderTrigger" NOT NULL,
    "offsetsDays" INTEGER[],
    "repeatEveryDays" INTEGER,
    "templateKey" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminder_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."reminder_log" (
    "id" TEXT NOT NULL,
    "obligationId" TEXT,
    "ruleId" TEXT,
    "track" "public"."ReminderTrack" NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "recipientUserId" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'email',
    "templateKey" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "scheduledFor" DATE NOT NULL,
    "sentAt" TIMESTAMPTZ,
    "status" "public"."DeliveryStatus" NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminder_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."email_template" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "email_template_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "public"."lead" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT,
    "email" TEXT,
    "mobile" TEXT,
    "country" TEXT,
    "source" "public"."LeadSource" NOT NULL,
    "serviceInterest" "public"."ServiceLine"[],
    "estimatedAnnualFee" DECIMAL(14,2),
    "stage" "public"."LeadStage" NOT NULL DEFAULT 'NEW',
    "lostReason" TEXT,
    "ownerId" TEXT NOT NULL,
    "nextActionDate" DATE NOT NULL,
    "nextAction" TEXT,
    "firstContactAt" TIMESTAMPTZ,
    "notes" TEXT,
    "convertedClientId" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."lost_reason" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "lost_reason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."communication" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "leadId" TEXT,
    "channel" "public"."CommChannel" NOT NULL,
    "direction" "public"."CommDirection" NOT NULL,
    "subject" TEXT NOT NULL,
    "summary" TEXT,
    "participants" TEXT[],
    "occurredAt" TIMESTAMPTZ NOT NULL,
    "obligationId" TEXT,
    "invoiceId" TEXT,
    "externalId" TEXT,
    "loggedById" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "communication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."task" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "clientId" TEXT,
    "obligationId" TEXT,
    "engagementId" TEXT,
    "assigneeId" TEXT,
    "priority" "public"."Priority" NOT NULL DEFAULT 'NORMAL',
    "dueDate" DATE,
    "status" "public"."TaskStatus" NOT NULL DEFAULT 'OPEN',
    "recurrence" TEXT,
    "blockedById" TEXT,
    "checklist" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."document" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "obligationId" TEXT,
    "type" "public"."DocumentType" NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "previousId" TEXT,
    "expiryDate" DATE,
    "isSensitive" BOOLEAN NOT NULL DEFAULT false,
    "uploadedById" TEXT,
    "uploadedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."invoice_series" (
    "id" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "invoice_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."invoice" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT,
    "isCreditNote" BOOLEAN NOT NULL DEFAULT false,
    "originalInvoiceId" TEXT,
    "clientId" TEXT NOT NULL,
    "invoiceDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "fxRateToAed" DECIMAL(14,6) NOT NULL DEFAULT 1,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "vatAmount" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "amountPaid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "public"."InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "cancelReason" TEXT,
    "paymentTerms" TEXT,
    "notes" TEXT,
    "collectionOwnerId" TEXT,
    "nextFollowUpDate" DATE,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."invoice_line" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "serviceLine" "public"."ServiceLine",
    "quantity" DECIMAL(12,2) NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vatRate" DECIMAL(5,2) NOT NULL,
    "vatAmount" DECIMAL(14,2) NOT NULL,
    "lineTotal" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "invoice_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."vat_rate" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "rate" DECIMAL(5,2) NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,

    CONSTRAINT "vat_rate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."receipt" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "receivedOn" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "unallocated" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."receipt_allocation" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "receipt_allocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."audit_log" (
    "id" BIGSERIAL NOT NULL,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "tableName" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "field" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "ip" TEXT,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."job_run" (
    "id" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "itemsProcessed" INTEGER NOT NULL DEFAULT 0,
    "itemsCreated" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "detail" JSONB,

    CONSTRAINT "job_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."connector_log" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "connector" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "detail" TEXT,
    "recordType" TEXT,
    "recordId" TEXT,

    CONSTRAINT "connector_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."app_setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "app_setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Role_key_key" ON "public"."Role"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_key_key" ON "public"."Permission"("key");

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "public"."user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_entraObjectId_key" ON "public"."user"("entraObjectId");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "public"."session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "client_clientCode_key" ON "public"."client"("clientCode");

-- CreateIndex
CREATE INDEX "client_status_deletedAt_idx" ON "public"."client"("status", "deletedAt");

-- CreateIndex
CREATE INDEX "client_legalName_idx" ON "public"."client"("legalName");

-- CreateIndex
CREATE INDEX "client_fyEndMonth_idx" ON "public"."client"("fyEndMonth");

-- CreateIndex
CREATE INDEX "client_emirate_idx" ON "public"."client"("emirate");

-- CreateIndex
CREATE UNIQUE INDEX "client_tax_profile_clientId_key" ON "public"."client_tax_profile"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "client_tax_profile_vatTrn_key" ON "public"."client_tax_profile"("vatTrn");

-- CreateIndex
CREATE UNIQUE INDEX "client_tax_profile_ctRegistrationNo_key" ON "public"."client_tax_profile"("ctRegistrationNo");

-- CreateIndex
CREATE INDEX "client_tax_profile_vatFrequency_idx" ON "public"."client_tax_profile"("vatFrequency");

-- CreateIndex
CREATE INDEX "contact_clientId_idx" ON "public"."contact"("clientId");

-- CreateIndex
CREATE INDEX "contact_email_idx" ON "public"."contact"("email");

-- CreateIndex
CREATE INDEX "service_engagement_clientId_idx" ON "public"."service_engagement"("clientId");

-- CreateIndex
CREATE INDEX "service_engagement_managerId_idx" ON "public"."service_engagement"("managerId");

-- CreateIndex
CREATE INDEX "service_engagement_partnerId_idx" ON "public"."service_engagement"("partnerId");

-- CreateIndex
CREATE INDEX "service_engagement_preparerId_idx" ON "public"."service_engagement"("preparerId");

-- CreateIndex
CREATE INDEX "deadline_rule_obligationType_jurisdiction_effectiveFrom_idx" ON "public"."deadline_rule"("obligationType", "jurisdiction", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "deadline_rule_code_version_key" ON "public"."deadline_rule"("code", "version");

-- CreateIndex
CREATE INDEX "obligation_statutoryDueDate_status_idx" ON "public"."obligation"("statutoryDueDate", "status");

-- CreateIndex
CREATE INDEX "obligation_preparerId_status_idx" ON "public"."obligation"("preparerId", "status");

-- CreateIndex
CREATE INDEX "obligation_reviewerId_status_idx" ON "public"."obligation"("reviewerId", "status");

-- CreateIndex
CREATE INDEX "obligation_clientId_type_idx" ON "public"."obligation"("clientId", "type");

-- CreateIndex
CREATE INDEX "obligation_status_internalTargetDate_idx" ON "public"."obligation"("status", "internalTargetDate");

-- CreateIndex
CREATE INDEX "obligation_status_history_obligationId_changedAt_idx" ON "public"."obligation_status_history"("obligationId", "changedAt");

-- CreateIndex
CREATE UNIQUE INDEX "holiday_jurisdiction_date_key" ON "public"."holiday"("jurisdiction", "date");

-- CreateIndex
CREATE UNIQUE INDEX "reminder_log_dedupeKey_key" ON "public"."reminder_log"("dedupeKey");

-- CreateIndex
CREATE INDEX "reminder_log_obligationId_idx" ON "public"."reminder_log"("obligationId");

-- CreateIndex
CREATE INDEX "reminder_log_status_createdAt_idx" ON "public"."reminder_log"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "lead_convertedClientId_key" ON "public"."lead"("convertedClientId");

-- CreateIndex
CREATE INDEX "lead_ownerId_stage_idx" ON "public"."lead"("ownerId", "stage");

-- CreateIndex
CREATE INDEX "lead_nextActionDate_idx" ON "public"."lead"("nextActionDate");

-- CreateIndex
CREATE UNIQUE INDEX "lost_reason_label_key" ON "public"."lost_reason"("label");

-- CreateIndex
CREATE UNIQUE INDEX "communication_externalId_key" ON "public"."communication"("externalId");

-- CreateIndex
CREATE INDEX "communication_clientId_occurredAt_idx" ON "public"."communication"("clientId", "occurredAt");

-- CreateIndex
CREATE INDEX "communication_leadId_occurredAt_idx" ON "public"."communication"("leadId", "occurredAt");

-- CreateIndex
CREATE INDEX "task_assigneeId_status_idx" ON "public"."task"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "task_clientId_idx" ON "public"."task"("clientId");

-- CreateIndex
CREATE INDEX "document_clientId_type_idx" ON "public"."document"("clientId", "type");

-- CreateIndex
CREATE INDEX "document_expiryDate_idx" ON "public"."document"("expiryDate");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_series_prefix_year_key" ON "public"."invoice_series"("prefix", "year");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_invoiceNumber_key" ON "public"."invoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "invoice_clientId_status_idx" ON "public"."invoice"("clientId", "status");

-- CreateIndex
CREATE INDEX "invoice_dueDate_status_idx" ON "public"."invoice"("dueDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "vat_rate_code_effectiveFrom_key" ON "public"."vat_rate"("code", "effectiveFrom");

-- CreateIndex
CREATE INDEX "audit_log_tableName_recordId_idx" ON "public"."audit_log"("tableName", "recordId");

-- CreateIndex
CREATE INDEX "audit_log_userId_at_idx" ON "public"."audit_log"("userId", "at");

-- CreateIndex
CREATE INDEX "audit_log_at_idx" ON "public"."audit_log"("at");

-- CreateIndex
CREATE INDEX "job_run_jobName_startedAt_idx" ON "public"."job_run"("jobName", "startedAt");

-- CreateIndex
CREATE INDEX "connector_log_connector_at_idx" ON "public"."connector_log"("connector", "at");

-- AddForeignKey
ALTER TABLE "public"."role_permission" ADD CONSTRAINT "role_permission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "public"."Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."role_permission" ADD CONSTRAINT "role_permission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "public"."Permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user" ADD CONSTRAINT "user_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "public"."Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user" ADD CONSTRAINT "user_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "public"."user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."client_tax_profile" ADD CONSTRAINT "client_tax_profile_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."contact" ADD CONSTRAINT "contact_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."service_engagement" ADD CONSTRAINT "service_engagement_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."service_engagement" ADD CONSTRAINT "service_engagement_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "public"."user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."service_engagement" ADD CONSTRAINT "service_engagement_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "public"."user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."service_engagement" ADD CONSTRAINT "service_engagement_preparerId_fkey" FOREIGN KEY ("preparerId") REFERENCES "public"."user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."obligation" ADD CONSTRAINT "obligation_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."obligation" ADD CONSTRAINT "obligation_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "public"."service_engagement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."obligation" ADD CONSTRAINT "obligation_preparerId_fkey" FOREIGN KEY ("preparerId") REFERENCES "public"."user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."obligation" ADD CONSTRAINT "obligation_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "public"."user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."obligation" ADD CONSTRAINT "obligation_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "public"."deadline_rule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."obligation_status_history" ADD CONSTRAINT "obligation_status_history_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "public"."obligation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."obligation_status_history" ADD CONSTRAINT "obligation_status_history_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "public"."user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."reminder_log" ADD CONSTRAINT "reminder_log_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "public"."obligation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."reminder_log" ADD CONSTRAINT "reminder_log_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "public"."reminder_rule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."lead" ADD CONSTRAINT "lead_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."lead" ADD CONSTRAINT "lead_convertedClientId_fkey" FOREIGN KEY ("convertedClientId") REFERENCES "public"."client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."communication" ADD CONSTRAINT "communication_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."communication" ADD CONSTRAINT "communication_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "public"."lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."communication" ADD CONSTRAINT "communication_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "public"."obligation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."communication" ADD CONSTRAINT "communication_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "public"."invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."task" ADD CONSTRAINT "task_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."task" ADD CONSTRAINT "task_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "public"."obligation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."task" ADD CONSTRAINT "task_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "public"."service_engagement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."task" ADD CONSTRAINT "task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "public"."user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."task" ADD CONSTRAINT "task_blockedById_fkey" FOREIGN KEY ("blockedById") REFERENCES "public"."task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document" ADD CONSTRAINT "document_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document" ADD CONSTRAINT "document_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "public"."obligation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."invoice" ADD CONSTRAINT "invoice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."invoice_line" ADD CONSTRAINT "invoice_line_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "public"."invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."receipt" ADD CONSTRAINT "receipt_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."receipt_allocation" ADD CONSTRAINT "receipt_allocation_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "public"."receipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."receipt_allocation" ADD CONSTRAINT "receipt_allocation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "public"."invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───── Constraints enforced in the database (BUILD_SPEC Section 5) ─────

-- A client cannot have two live obligations of the same type for the same period.
CREATE UNIQUE INDEX "obligation_client_type_period_live_key"
  ON "obligation" ("clientId", "type", "periodStart", "periodEnd")
  WHERE "deletedAt" IS NULL;

-- An obligation cannot be Submitted (or later) without a submission reference,
-- except obligation types that have no submission (licence/engagement renewal, document expiry).
ALTER TABLE "obligation" ADD CONSTRAINT "obligation_submitted_requires_reference"
  CHECK ("status" NOT IN ('SUBMITTED','PAYMENT_PENDING') OR "submissionReference" IS NOT NULL);

-- Completed requires payment confirmation or an explicit waiver with a reason.
ALTER TABLE "obligation" ADD CONSTRAINT "obligation_completed_requires_payment_or_waiver"
  CHECK ("status" <> 'COMPLETED' OR "paymentStatus" IN ('PAID','NOT_APPLICABLE')
         OR ("paymentStatus" = 'WAIVED' AND "waiverReason" IS NOT NULL));

-- On Hold requires a reason.
ALTER TABLE "obligation" ADD CONSTRAINT "obligation_on_hold_requires_reason"
  CHECK ("status" <> 'ON_HOLD' OR "onHoldReason" IS NOT NULL);

-- Lost lead requires a reason.
ALTER TABLE "lead" ADD CONSTRAINT "lead_lost_requires_reason"
  CHECK ("stage" <> 'LOST' OR "lostReason" IS NOT NULL);

-- Cancelled invoice requires a reason.
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_cancel_requires_reason"
  CHECK ("status" <> 'CANCELLED' OR "cancelReason" IS NOT NULL);

-- Audit log and reminder dedupe are append-only: no code path may update or delete rows.
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER status_history_no_update BEFORE UPDATE OR DELETE ON "obligation_status_history"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- reminder_log rows may be updated (status QUEUED -> SENT) but never deleted.
CREATE TRIGGER reminder_log_no_delete BEFORE DELETE ON "reminder_log"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Hard deletes are blocked on soft-delete tables.
CREATE TRIGGER client_no_delete BEFORE DELETE ON "client" FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER obligation_no_delete BEFORE DELETE ON "obligation" FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER invoice_no_delete BEFORE DELETE ON "invoice" FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER document_no_delete BEFORE DELETE ON "document" FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Full-text / trigram search on clients.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "client_search_trgm" ON "client" USING gin ("searchText" gin_trgm_ops);
