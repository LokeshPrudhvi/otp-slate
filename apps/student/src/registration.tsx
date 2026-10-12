import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { api, useData } from "@slate/ui";
import { AuthFrame } from "./auth";

type Registration = {
  studentId: string;
  name: string;
  email: string;
  phone: string;
  organizationId: string;
  branchName: string;
  branchCode: string;
  cohort: string;
};
type FieldName = keyof Registration;
type FieldErrors = Partial<Record<FieldName, string>>;
type OrganizationOption = { id: string; name: string };

const initialValues: Registration = {
  studentId: "",
  name: "",
  email: "",
  phone: "",
  organizationId: "",
  branchName: "",
  branchCode: "",
  cohort: "",
};
const fields: {
  name: Exclude<FieldName, "organizationId">;
  label: string;
  maxLength: number;
  type?: "email" | "tel";
  autoComplete?: string;
  hint?: string;
  optional?: boolean;
}[] = [
  { name: "name", label: "Full name", maxLength: 120, autoComplete: "name" },
  { name: "studentId", label: "Student ID / roll number", maxLength: 80 },
  {
    name: "email",
    label: "Email address",
    maxLength: 200,
    type: "email",
    autoComplete: "email",
    hint: "Your welcome email will be sent here after approval.",
  },
  {
    name: "phone",
    label: "Phone number",
    maxLength: 30,
    type: "tel",
    autoComplete: "tel",
    hint: "Enter a 10-digit Indian mobile number or include your country code, e.g. +91.",
  },
  {
    name: "branchName",
    label: "Branch name",
    maxLength: 120,
    hint: "For example, Computer Science.",
  },
  {
    name: "branchCode",
    label: "Branch code",
    maxLength: 32,
    hint: "For example, CSE. Saved in uppercase.",
  },
  {
    name: "cohort",
    label: "Cohort / batch",
    maxLength: 120,
    optional: true,
    hint: "For example, 2026–2030.",
  },
];

function normalizePhone(value: string) {
  const compact = value.replace(/[\s()-]/g, "");
  return /^[6-9]\d{9}$/.test(compact) ? `+91${compact}` : compact;
}

export function StudentRegistration() {
  const organizations = useData<OrganizationOption[]>(
    "registration-organizations",
    "registration/organizations",
  );
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState<FieldErrors>({});
  const inFlight = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const successRef = useRef<HTMLDivElement>(null);
  const registration = useMutation({
    mutationFn: (input: Omit<Registration, "cohort"> & { cohort?: string }) =>
      api<{ id: string; status: "pending" }>(
        "registration/requests",
        "POST",
        input,
      ),
    onSettled: () => {
      inFlight.current = false;
    },
  });
  useEffect(() => {
    if (registration.isSuccess) successRef.current?.focus();
  }, [registration.isSuccess]);

  function update(name: FieldName, value: string) {
    setValues((current) => ({
      ...current,
      [name]: name === "branchCode" ? value.toUpperCase() : value,
    }));
    setErrors((current) => ({ ...current, [name]: undefined }));
    if (registration.isError) registration.reset();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || registration.isSuccess) return;
    const input = {
      studentId: values.studentId.trim(),
      name: values.name.trim(),
      email: values.email.trim().toLowerCase(),
      phone: normalizePhone(values.phone),
      organizationId: values.organizationId,
      branchName: values.branchName.trim(),
      branchCode: values.branchCode.trim().toUpperCase(),
      ...(values.cohort.trim() ? { cohort: values.cohort.trim() } : {}),
    };
    const nextErrors: FieldErrors = {};
    for (const field of fields) {
      const value = input[field.name];
      if (!field.optional && !value)
        nextErrors[field.name] = `Enter your ${field.label.toLowerCase()}.`;
      else if (value && value.length > field.maxLength)
        nextErrors[field.name] = `Use ${field.maxLength} characters or fewer.`;
    }
    if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email))
      nextErrors.email = "Enter a valid email address.";
    if (input.phone && !/^\+[1-9]\d{7,14}$/.test(input.phone))
      nextErrors.phone =
        "Enter a 10-digit Indian mobile number starting with 6–9, or a number with its +country code.";
    if (!organizations.data?.some((org) => org.id === input.organizationId))
      nextErrors.organizationId = "Choose your college from the list.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      const first = [
        ...fields.map((field) => field.name),
        "organizationId",
      ].find((name) => nextErrors[name as FieldName]);
      formRef.current
        ?.querySelector<HTMLElement>(`#registration-${first}`)
        ?.focus();
      return;
    }
    inFlight.current = true;
    registration.mutate(input);
  }

  const collegesReady = !!organizations.data?.length && !organizations.isError;
  return (
    <AuthFrame
      className="student-registration"
      title={
        registration.isSuccess ? "Application received." : "Create an account"
      }
      description={
        registration.isSuccess
          ? "Your registration is pending Platform Admin approval."
          : "Tell us about yourself and your college. Platform Admin will review your registration before creating your student account."
      }
    >
      {registration.isSuccess ? (
        <div
          className="registration-success"
          ref={successRef}
          tabIndex={-1}
          role="status"
        >
          <span className="registration-pending">Pending approval</span>
          <p>
            After approval, a welcome email with your temporary password will be
            sent to <strong>{registration.variables?.email}</strong>.
          </p>
          <p>
            You can sign in once approved. You will be asked to change the
            temporary password on your first sign-in.
          </p>
          <p className="auth-help">
            Contact your placement team if you need to update your application.
          </p>
        </div>
      ) : (
        <form
          ref={formRef}
          onSubmit={submit}
          noValidate
          aria-busy={registration.isPending}
        >
          <p className="auth-help">
            All fields are required unless marked optional.
          </p>
          <fieldset
            className="registration-fields"
            disabled={registration.isPending}
          >
            <legend className="student-skip">
              Student registration details
            </legend>
            <div className="registration-grid">
              {fields.map((field) => (
                <div className="registration-field" key={field.name}>
                  <label htmlFor={`registration-${field.name}`}>
                    {field.label}
                    {field.optional ? " (optional)" : ""}
                  </label>
                  <input
                    id={`registration-${field.name}`}
                    name={field.name}
                    type={field.type || "text"}
                    required={!field.optional}
                    maxLength={field.maxLength}
                    autoComplete={field.autoComplete || "off"}
                    autoCapitalize={
                      field.name === "branchCode" ? "characters" : undefined
                    }
                    spellCheck={
                      field.name === "email" || field.name === "branchCode"
                        ? false
                        : undefined
                    }
                    value={values[field.name]}
                    onChange={(event) => update(field.name, event.target.value)}
                    aria-invalid={!!errors[field.name]}
                    aria-describedby={
                      [
                        field.hint ? `registration-${field.name}-hint` : "",
                        errors[field.name]
                          ? `registration-${field.name}-error`
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" ") || undefined
                    }
                  />
                  {field.hint && (
                    <p
                      id={`registration-${field.name}-hint`}
                      className="registration-hint"
                    >
                      {field.hint}
                    </p>
                  )}
                  {errors[field.name] && (
                    <p
                      id={`registration-${field.name}-error`}
                      className="registration-error"
                    >
                      {errors[field.name]}
                    </p>
                  )}
                </div>
              ))}
              <div className="registration-field registration-college">
                <label htmlFor="registration-organizationId">
                  College / organization
                </label>
                <select
                  id="registration-organizationId"
                  name="organizationId"
                  required
                  disabled={!collegesReady || registration.isPending}
                  value={values.organizationId}
                  onChange={(event) =>
                    update("organizationId", event.target.value)
                  }
                  aria-invalid={!!errors.organizationId}
                  aria-describedby={
                    errors.organizationId
                      ? "registration-organizationId-error"
                      : "registration-college-help"
                  }
                >
                  <option value="">
                    {organizations.isPending
                      ? "Loading colleges…"
                      : "Choose your college"}
                  </option>
                  {organizations.data?.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </select>
                <p className="registration-hint" id="registration-college-help">
                  College missing? Contact your placement team before
                  registering.
                </p>
                {errors.organizationId && (
                  <p
                    className="registration-error"
                    id="registration-organizationId-error"
                  >
                    {errors.organizationId}
                  </p>
                )}
              </div>
            </div>
          </fieldset>
          {organizations.isPending && (
            <p className="auth-message" role="status">
              Loading available colleges…
            </p>
          )}
          {organizations.isError && (
            <div className="auth-message" role="alert">
              <p>
                We could not load colleges. Your details are still here; retry
                to continue.
              </p>
              <button
                className="auth-link"
                type="button"
                disabled={organizations.isFetching}
                onClick={() => organizations.refetch()}
              >
                {organizations.isFetching
                  ? "Retrying…"
                  : "Retry loading colleges"}
              </button>
            </div>
          )}
          {organizations.isSuccess && !organizations.data.length && (
            <p className="auth-message" role="status">
              No colleges are available for registration yet. Contact your
              placement team.
            </p>
          )}
          {!!Object.keys(errors).filter((name) => errors[name as FieldName])
            .length && (
            <p className="registration-error" role="alert">
              Check the highlighted fields before submitting.
            </p>
          )}
          {registration.isError && (
            <p className="registration-error" role="alert">
              {registration.error.message ||
                "We could not submit your application. Please retry."}
            </p>
          )}
          <button
            className="lg-btn"
            type="submit"
            disabled={registration.isPending || !collegesReady}
          >
            {registration.isPending
              ? "Submitting application…"
              : "Submit for approval"}
          </button>
          <p className="auth-help">
            Your account and temporary password are issued only after approval.
          </p>
        </form>
      )}
      <Link className="auth-link" to="/login">
        Back to sign in
      </Link>
    </AuthFrame>
  );
}
