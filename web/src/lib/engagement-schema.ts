import { z } from "zod";

export const FRAMEWORKS = ["AICPA", "IFRS", "PCAOB"] as const;
export const INDUSTRIES = [
  "Manufacturing",
  "SaaS",
  "NFP",
  "ConsumerBusiness",
  "RealEstate",
] as const;
export const RISK_CATEGORIES = [
  "Industry",
  "EntitySpecific",
  "Fraud",
  "GoingConcern",
  "RelatedParty",
  "SignificantEstimate",
  "ITGeneral",
  "Other",
] as const;
export const BUSINESS_CHANGE_CATEGORIES = [
  "ManagementChange",
  "SystemChange",
  "NewProductOrMarket",
  "MergerOrAcquisition",
  "Restructuring",
  "SignificantContract",
  "RegulatoryChange",
  "Other",
] as const;

export const FRAMEWORK_LABELS: Record<(typeof FRAMEWORKS)[number], string> = {
  AICPA: "AICPA (US GAAS)",
  IFRS: "IFRS",
  PCAOB: "PCAOB",
};

export const INDUSTRY_LABELS: Record<(typeof INDUSTRIES)[number], string> = {
  Manufacturing: "Manufacturing",
  SaaS: "SaaS",
  NFP: "Not-for-Profit",
  ConsumerBusiness: "Consumer Business",
  RealEstate: "Real Estate",
};

export const RISK_CATEGORY_LABELS: Record<
  (typeof RISK_CATEGORIES)[number],
  string
> = {
  Industry: "Industry",
  EntitySpecific: "Entity-Specific",
  Fraud: "Fraud",
  GoingConcern: "Going Concern",
  RelatedParty: "Related Party",
  SignificantEstimate: "Significant Estimate",
  ITGeneral: "IT General",
  Other: "Other",
};

export const BUSINESS_CHANGE_CATEGORY_LABELS: Record<
  (typeof BUSINESS_CHANGE_CATEGORIES)[number],
  string
> = {
  ManagementChange: "Management Change",
  SystemChange: "System Change",
  NewProductOrMarket: "New Product or Market",
  MergerOrAcquisition: "Merger or Acquisition",
  Restructuring: "Restructuring",
  SignificantContract: "Significant Contract",
  RegulatoryChange: "Regulatory Change",
  Other: "Other",
};

const FileReferenceSchema = z.object({
  storagePath: z.string().min(1),
  originalFilename: z.string().min(1).max(300),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  uploadedAt: z.string().datetime({ offset: true }),
});

const AnswerSchema = z.object({
  value: z.string().max(10000),
  description: z.string().max(10000),
});

const QuestionnaireAnswersSchema = z.record(z.string(), AnswerSchema);

export const EngagementSetupSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    engagementId: z.string().uuid(),
    client: z.object({
      name: z.string().min(1).max(200),
      fiscalYearEnd: z.string().date(),
      reportingPeriodStart: z.string().date().optional(),
    }),
    framework: z.enum(FRAMEWORKS),
    industry: z.enum(INDUSTRIES),
    pyAuditFile: FileReferenceSchema,
    cyTrialBalanceFile: FileReferenceSchema,
    planningQuestionnaire: QuestionnaireAnswersSchema,
    materiality: z
      .object({
        currency: z.literal("USD"),
        overallMateriality: z.number().positive(),
        performanceMateriality: z.number().positive(),
        clearlyTrivialThreshold: z.number().positive(),
      })
      .superRefine((m, ctx) => {
        if (m.performanceMateriality > m.overallMateriality) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["performanceMateriality"],
            message:
              "Performance materiality cannot exceed overall materiality",
          });
        }
        if (m.clearlyTrivialThreshold > m.performanceMateriality) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["clearlyTrivialThreshold"],
            message:
              "Clearly trivial threshold cannot exceed performance materiality",
          });
        }
      }),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type EngagementSetup = z.infer<typeof EngagementSetupSchema>;

// Form-input variant: file uploads happen separately, so the form omits file
// reference objects. Materiality fields are typed as strings (form inputs)
// and coerced to numbers on submit.
export const EngagementFormSchema = z
  .object({
    clientName: z.string().min(1, "Client name is required").max(200),
    fiscalYearEnd: z.string().date(),
    reportingPeriodStart: z.string().date().or(z.literal("")).optional(),
    framework: z.enum(FRAMEWORKS),
    industry: z.enum(INDUSTRIES),
    planningQuestionnaire: QuestionnaireAnswersSchema,
    overallMateriality: z.coerce.number().positive(
      "Overall materiality must be greater than 0",
    ),
    performanceMateriality: z.coerce.number().positive(
      "Performance materiality must be greater than 0",
    ),
    clearlyTrivialThreshold: z.coerce.number().positive(
      "Clearly trivial threshold must be greater than 0",
    ),
  })
  .strict()
  // Materiality must descend: PM ≤ OM and CTT ≤ PM. Errors attach to
  // the lower field so the red message appears under the value that
  // needs to come down.
  .superRefine((data, ctx) => {
    if (data.performanceMateriality > data.overallMateriality) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["performanceMateriality"],
        message:
          "Performance materiality cannot exceed overall materiality",
      });
    }
    if (data.clearlyTrivialThreshold > data.performanceMateriality) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["clearlyTrivialThreshold"],
        message:
          "Clearly trivial threshold cannot exceed performance materiality",
      });
    }
  });

export type EngagementFormValues = z.infer<typeof EngagementFormSchema>;
