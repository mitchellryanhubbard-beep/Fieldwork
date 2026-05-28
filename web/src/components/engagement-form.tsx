"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFieldArray, useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import {
  EngagementFormSchema,
  type EngagementFormValues,
  FRAMEWORKS,
  FRAMEWORK_LABELS,
  INDUSTRIES,
  INDUSTRY_LABELS,
  RISK_CATEGORIES,
  RISK_CATEGORY_LABELS,
  BUSINESS_CHANGE_CATEGORIES,
  BUSINESS_CHANGE_CATEGORY_LABELS,
} from "@/lib/engagement-schema";

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
  riskNarrative: "",
  riskItems: [],
  businessChangesNarrative: "",
  businessChangeItems: [],
  overallMateriality: 0,
  performanceMateriality: 0,
  clearlyTrivialThreshold: 0,
  materialityBasis: "",
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
    },
    mode: "onBlur",
  });

  const riskItems = useFieldArray({
    control: form.control,
    name: "riskItems",
  });
  const businessChangeItems = useFieldArray({
    control: form.control,
    name: "businessChangeItems",
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
        title="Client + Framework"
        description="Drives industry-specific templates and assertion-risk mapping downstream."
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
        description="Overall materiality, performance materiality, and the clearly trivial threshold drive scoping and exception flagging."
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
          <div className="sm:col-span-3">
            <Field
              label="Basis"
              error={form.formState.errors.materialityBasis?.message}
            >
              <Textarea
                rows={3}
                placeholder="e.g., Overall = 5% of pretax income; PM = 75% of overall; CTT = 5% of PM."
                {...form.register("materialityBasis")}
              />
            </Field>
          </div>
        </div>
      </NumberedSection>

      <NumberedSection
        n={n0 + 2}
        title="CY Risk Profile"
        description="Identified risks for the current year. Each item is consumed by the assertion-risk matrix."
      >
        <div className="grid gap-4 rounded-xl border border-primary/10 bg-card p-5">
          <Field label="Narrative (optional)">
            <Textarea rows={3} {...form.register("riskNarrative")} />
          </Field>
          <div className="space-y-3">
            {riskItems.fields.length === 0 ? (
              <p className="text-sm text-muted-foreground">No risks yet.</p>
            ) : null}
            {riskItems.fields.map((field, index) => (
              <div
                key={field.id}
                className="grid gap-3 rounded-md border bg-muted/30 p-3 sm:grid-cols-[200px_1fr_auto]"
              >
                <Select
                  value={form.watch(`riskItems.${index}.category`)}
                  onValueChange={(v) =>
                    form.setValue(
                      `riskItems.${index}.category`,
                      v as (typeof RISK_CATEGORIES)[number],
                      { shouldDirty: true },
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent>
                    {RISK_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {RISK_CATEGORY_LABELS[c]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Textarea
                  rows={2}
                  placeholder="Describe the risk"
                  {...form.register(`riskItems.${index}.description`)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => riskItems.remove(index)}
                >
                  Remove
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() =>
                riskItems.append({ category: "Other", description: "" })
              }
            >
              + Add risk
            </Button>
          </div>
        </div>
      </NumberedSection>

      <NumberedSection
        n={n0 + 3}
        title="CY Significant Business Changes"
        description="Material changes since the prior year — management, systems, M&A, new products, etc."
      >
        <div className="grid gap-4 rounded-xl border border-primary/10 bg-card p-5">
          <Field label="Narrative (optional)">
            <Textarea rows={3} {...form.register("businessChangesNarrative")} />
          </Field>
          <div className="space-y-3">
            {businessChangeItems.fields.length === 0 ? (
              <p className="text-sm text-muted-foreground">No changes yet.</p>
            ) : null}
            {businessChangeItems.fields.map((field, index) => (
              <div
                key={field.id}
                className="grid gap-3 rounded-md border bg-muted/30 p-3 sm:grid-cols-[220px_1fr_auto]"
              >
                <Select
                  value={form.watch(`businessChangeItems.${index}.category`)}
                  onValueChange={(v) =>
                    form.setValue(
                      `businessChangeItems.${index}.category`,
                      v as (typeof BUSINESS_CHANGE_CATEGORIES)[number],
                      { shouldDirty: true },
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent>
                    {BUSINESS_CHANGE_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {BUSINESS_CHANGE_CATEGORY_LABELS[c]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Textarea
                  rows={2}
                  placeholder="Describe the change"
                  {...form.register(
                    `businessChangeItems.${index}.description`,
                  )}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => businessChangeItems.remove(index)}
                >
                  Remove
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() =>
                businessChangeItems.append({
                  category: "Other",
                  description: "",
                })
              }
            >
              + Add change
            </Button>
          </div>
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
