"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import {
  EngagementFormSchema,
  type EngagementFormValues,
  FRAMEWORKS,
  FRAMEWORK_LABELS,
  INDUSTRIES,
  INDUSTRY_LABELS,
} from "@/lib/engagement-schema";
import {
  PLANNING_QUESTIONNAIRE,
  emptyQuestionnaireAnswers,
  type Question,
} from "@/lib/planning-questionnaire";

import { Button } from "@/components/ui/button";
import { NumberedSection } from "@/components/numbered-section";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type SubmitArgs = {
  values: EngagementFormValues;
};

type SubmitFn = (
  args: SubmitArgs,
) => Promise<{ ok: true; id?: string } | { ok: false; error: string }>;

export type EngagementFormProps = {
  mode: "create" | "edit";
  defaultValues?: Partial<EngagementFormValues>;
  onSubmitAction: SubmitFn;
  // First section number. Defaults to 2 because the edit page renders
  // "Source files" as section 1 above this form. The create page (no
  // file uploads yet) passes 1 so its numbering starts at 1.
  startingNumber?: number;
};

const EMPTY_DEFAULTS: EngagementFormValues = {
  clientName: "",
  fiscalYearEnd: "",
  reportingPeriodStart: "",
  framework: "AICPA",
  industry: "Manufacturing",
  planningQuestionnaire: emptyQuestionnaireAnswers(),
  overallMateriality: 0,
  performanceMateriality: 0,
  clearlyTrivialThreshold: 0,
};

export function EngagementForm({
  mode,
  defaultValues,
  onSubmitAction,
  startingNumber = 2,
}: EngagementFormProps) {
  const n0 = startingNumber;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<EngagementFormValues>({
    resolver: zodResolver(EngagementFormSchema) as unknown as Resolver<EngagementFormValues>,
    defaultValues: {
      ...EMPTY_DEFAULTS,
      ...defaultValues,
      // Always seed every question slot so the UI has something to bind.
      // Saved answers override; new questions added later get blank slots.
      planningQuestionnaire: {
        ...emptyQuestionnaireAnswers(),
        ...(defaultValues?.planningQuestionnaire ?? {}),
      },
    },
    mode: "onBlur",
  });

  const onSubmit = form.handleSubmit((values) => {
    setServerError(null);
    startTransition(async () => {
      const result = await onSubmitAction({ values });
      if (!result.ok) {
        setServerError(result.error);
        toast.error("Save failed", { description: result.error });
        return;
      }
      toast.success(mode === "create" ? "Engagement created" : "Engagement saved");
      router.refresh();
    });
  });

  return (
    <form onSubmit={onSubmit} className="space-y-8">
      <NumberedSection
        n={n0}
        title="Client Information"
        description="Input client name, fiscal year end, framework, and industry to drive industry-specific templates and assertion-risk mapping downstream."
      >
        <div className="grid gap-4 rounded-xl border border-primary/10 bg-card p-5 sm:grid-cols-2">
          <Field
            label="Client name"
            error={form.formState.errors.clientName?.message}
          >
            <Input {...form.register("clientName")} />
          </Field>
          <Field
            label="Fiscal year end"
            error={form.formState.errors.fiscalYearEnd?.message}
          >
            <Input type="date" {...form.register("fiscalYearEnd")} />
          </Field>
          <Field
            label="Reporting period start (optional)"
            error={form.formState.errors.reportingPeriodStart?.message}
          >
            <Input type="date" {...form.register("reportingPeriodStart")} />
          </Field>
          <Field
            label="Audit framework"
            error={form.formState.errors.framework?.message}
          >
            <Select
              value={form.watch("framework")}
              onValueChange={(v) =>
                form.setValue("framework", v as EngagementFormValues["framework"], {
                  shouldDirty: true,
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FRAMEWORKS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {FRAMEWORK_LABELS[f]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field
            label="Industry"
            error={form.formState.errors.industry?.message}
          >
            <Select
              value={form.watch("industry")}
              onValueChange={(v) =>
                form.setValue("industry", v as EngagementFormValues["industry"], {
                  shouldDirty: true,
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INDUSTRIES.map((i) => (
                  <SelectItem key={i} value={i}>
                    {INDUSTRY_LABELS[i]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </NumberedSection>

      <NumberedSection
        n={n0 + 1}
        title="Materiality"
        description="Input engagement materiality to drive scoping, sample sizes, and exception flagging across every downstream test."
      >
        <div className="grid gap-4 rounded-xl border border-primary/10 bg-card p-5 sm:grid-cols-3">
          <Field
            label="Overall materiality (USD)"
            error={form.formState.errors.overallMateriality?.message}
          >
            <Input
              type="number"
              step="0.01"
              min="0"
              {...form.register("overallMateriality")}
            />
          </Field>
          <Field
            label="Performance materiality (USD)"
            error={form.formState.errors.performanceMateriality?.message}
          >
            <Input
              type="number"
              step="0.01"
              min="0"
              {...form.register("performanceMateriality")}
            />
          </Field>
          <Field
            label="Clearly trivial threshold (USD)"
            error={form.formState.errors.clearlyTrivialThreshold?.message}
          >
            <Input
              type="number"
              step="0.01"
              min="0"
              {...form.register("clearlyTrivialThreshold")}
            />
          </Field>
        </div>
      </NumberedSection>

      <NumberedSection
        n={n0 + 2}
        title="Planning & Risk Questionnaire"
        description="Identify current-year significant business changes, identify CY audit risks, and give the AI context to modify the audit approach from PY. Expand each section below to answer the questions accordingly."
      >
        <div className="space-y-3 rounded-xl border border-primary/10 bg-card p-5">
          {PLANNING_QUESTIONNAIRE.map((group) => (
            <details
              key={group.title}
              className="group rounded-md border border-primary/10 bg-background/60"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.18em] text-primary [&::-webkit-details-marker]:hidden">
                <span>{group.title}</span>
                <span className="text-sm text-primary/40 transition group-open:rotate-90">
                  ▸
                </span>
              </summary>
              <div className="space-y-4 border-t border-primary/10 px-4 py-4">
                {group.questions.map((q) => (
                  <QuestionRow key={q.id} question={q} form={form} />
                ))}
              </div>
            </details>
          ))}
        </div>
      </NumberedSection>

      {serverError ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-5">
          <p className="font-display text-lg font-medium text-destructive">
            Save failed
          </p>
          <p className="mt-1 text-sm text-foreground/70">{serverError}</p>
        </div>
      ) : null}

      <div className="sticky bottom-0 -mx-6 mt-4 flex justify-end gap-3 border-t border-primary/10 bg-background/85 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <Button type="submit" disabled={isPending} variant="gold">
          {isPending
            ? "Saving…"
            : mode === "create"
              ? "Create engagement"
              : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

// One row of the Planning & Risk Questionnaire. "text" questions render a
// single textarea. "yesNo" questions render a No/Yes radio pair with a
// follow-up "Describe:" textarea that only appears when Yes is selected.
function QuestionRow({
  question,
  form,
}: {
  question: Question;
  form: ReturnType<typeof useForm<EngagementFormValues>>;
}) {
  const valuePath = `planningQuestionnaire.${question.id}.value` as const;
  const descPath =
    `planningQuestionnaire.${question.id}.description` as const;

  if (question.kind === "text") {
    return (
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-primary">{question.prompt}</p>
        <Textarea
          rows={3}
          placeholder={question.placeholder}
          {...form.register(valuePath)}
        />
      </div>
    );
  }

  const current = form.watch(valuePath);
  const showDescribe = current === "yes";
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-primary">{question.prompt}</p>
      {question.examples ? (
        <p className="text-xs text-foreground/60">
          Examples: {question.examples.join(" · ")}
        </p>
      ) : null}
      <div className="flex items-center gap-5 text-sm">
        <label className="inline-flex items-center gap-1.5">
          <input
            type="radio"
            value="no"
            className="size-3.5 accent-primary"
            {...form.register(valuePath)}
          />
          No
        </label>
        <label className="inline-flex items-center gap-1.5">
          <input
            type="radio"
            value="yes"
            className="size-3.5 accent-primary"
            {...form.register(valuePath)}
          />
          Yes
        </label>
      </div>
      {showDescribe ? (
        <Textarea
          rows={2}
          placeholder="Describe:"
          {...form.register(descPath)}
        />
      ) : null}
    </div>
  );
}
