// Planning & Risk Questionnaire registry. Drives the form UI and the matrix
// prompt's "Planning & Risk" block. Questions are grouped by audit area;
// answers feed Claude as the canonical CY context (replacing the previous
// free-form Risk Profile + Business Changes lists).

export type QuestionTextOnly = {
  id: string;
  kind: "text";
  prompt: string;
  placeholder?: string;
};

export type QuestionYesNo = {
  id: string;
  kind: "yesNo";
  prompt: string;
  examples?: string[];
};

export type Question = QuestionTextOnly | QuestionYesNo;

export type QuestionGroup = {
  title: string;
  questions: Question[];
};

export type Answer = {
  // For "text" questions: the narrative. For "yesNo" questions: "yes" | "no" | "".
  value: string;
  // Free-text "Describe:" follow-up. Only meaningful for yesNo questions
  // answered "yes" — the form hides it otherwise.
  description: string;
};

export type QuestionnaireAnswers = Record<string, Answer>;

export const PLANNING_QUESTIONNAIRE: QuestionGroup[] = [
  {
    title: "Business overview",
    questions: [
      {
        id: "q1",
        kind: "text",
        prompt: "Describe the organization's primary business activities.",
        placeholder:
          "What does the company do? Key revenue streams, products, customers.",
      },
      {
        id: "q2",
        kind: "yesNo",
        prompt:
          "Did the organization enter any new lines of business during the year?",
      },
      {
        id: "q3",
        kind: "yesNo",
        prompt: "Did the organization discontinue any operations?",
      },
    ],
  },
  {
    title: "Revenue & customers",
    questions: [
      {
        id: "q4",
        kind: "yesNo",
        prompt: "Were there any significant changes in revenue sources?",
        examples: [
          "New customer types",
          "New contracts",
          "New grants",
          "New products",
        ],
      },
      {
        id: "q5",
        kind: "yesNo",
        prompt: "Did revenue increase or decrease by more than 20%?",
      },
      {
        id: "q6",
        kind: "yesNo",
        prompt: "Were there any significant customer concentrations?",
      },
      {
        id: "q7",
        kind: "yesNo",
        prompt:
          "Did management implement any new pricing structures or billing methods?",
      },
    ],
  },
  {
    title: "Technology & systems",
    questions: [
      {
        id: "q8",
        kind: "yesNo",
        prompt:
          "Did the organization implement a new ERP or accounting system?",
      },
      {
        id: "q9",
        kind: "yesNo",
        prompt: "Were any significant IT systems modified?",
      },
      {
        id: "q10",
        kind: "yesNo",
        prompt: "Did any key financial reporting processes change?",
      },
    ],
  },
  {
    title: "Personnel",
    questions: [
      {
        id: "q11",
        kind: "yesNo",
        prompt:
          "Did the organization experience turnover in key management positions?",
        examples: ["CEO", "CFO", "Controller", "Accounting Manager"],
      },
      {
        id: "q12",
        kind: "yesNo",
        prompt:
          "Were there significant staffing changes in accounting or finance?",
      },
    ],
  },
  {
    title: "Financing & capital structure",
    questions: [
      {
        id: "q13",
        kind: "yesNo",
        prompt: "Did the organization obtain new debt?",
      },
      {
        id: "q14",
        kind: "yesNo",
        prompt: "Did the organization refinance existing debt?",
      },
      {
        id: "q15",
        kind: "yesNo",
        prompt: "Were there significant equity transactions?",
        examples: ["Capital raise", "Ownership changes", "Stock issuances"],
      },
    ],
  },
  {
    title: "Operations",
    questions: [
      {
        id: "q16",
        kind: "yesNo",
        prompt:
          "Did the organization acquire another company, program, or business unit?",
      },
      {
        id: "q17",
        kind: "yesNo",
        prompt: "Did the organization open or close locations?",
      },
      {
        id: "q18",
        kind: "yesNo",
        prompt: "Were there any significant vendor changes?",
      },
    ],
  },
  {
    title: "Compliance & legal",
    questions: [
      {
        id: "q19",
        kind: "yesNo",
        prompt: "Were there any regulatory investigations or inquiries?",
      },
      {
        id: "q20",
        kind: "yesNo",
        prompt:
          "Were there any significant lawsuits, claims, or contingencies?",
      },
      {
        id: "q21",
        kind: "yesNo",
        prompt: "Were there any cybersecurity incidents?",
      },
    ],
  },
  {
    title: "Fraud & internal controls",
    questions: [
      {
        id: "q22",
        kind: "yesNo",
        prompt: "Were any control deficiencies identified during the year?",
      },
      {
        id: "q23",
        kind: "yesNo",
        prompt: "Were any prior-year audit findings unresolved?",
      },
      {
        id: "q24",
        kind: "yesNo",
        prompt: "Has management identified any known fraud or suspected fraud?",
      },
    ],
  },
  {
    title: "Financial reporting",
    questions: [
      {
        id: "q25",
        kind: "yesNo",
        prompt: "Were there any new accounting policies adopted?",
      },
      {
        id: "q26",
        kind: "yesNo",
        prompt: "Were there any unusual or non-routine transactions?",
        examples: [
          "Asset sales",
          "Debt restructuring",
          "Related-party transactions",
        ],
      },
      {
        id: "q27",
        kind: "yesNo",
        prompt:
          "Were there any significant estimates that changed materially?",
        examples: ["Allowance", "Inventory reserves", "Useful lives"],
      },
    ],
  },
];

// Flat lookup by question id, useful for prompt + read-side validation.
export const QUESTIONS_BY_ID: Record<string, Question> = Object.fromEntries(
  PLANNING_QUESTIONNAIRE.flatMap((g) => g.questions).map((q) => [q.id, q]),
);

// Empty answer set — all questions present with blank value + description.
// Use this as the form default and the DB-write fallback so the JSON shape
// is always the same.
export function emptyQuestionnaireAnswers(): QuestionnaireAnswers {
  const result: QuestionnaireAnswers = {};
  for (const q of Object.values(QUESTIONS_BY_ID)) {
    result[q.id] = { value: "", description: "" };
  }
  return result;
}
