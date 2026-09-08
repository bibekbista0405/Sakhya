"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { MessageCircle, ChevronLeft, User, Calendar, Users, Mail, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

const TOTAL_STEPS = 5;

const GENDER_OPTIONS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "custom", label: "Custom" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];

function calculateAge(dob: string): number {
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

export default function RegisterPage() {
  const { register } = useAuth();
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function validateStep(): string | null {
    if (step === 1) {
      if (!firstName.trim() || !lastName.trim()) return "Please enter your first and last name.";
      if (firstName.trim().length > 50 || lastName.trim().length > 50) return "Names are too long.";
    }
    if (step === 2) {
      if (!dateOfBirth) return "Please enter your date of birth.";
      const age = calculateAge(dateOfBirth);
      if (Number.isNaN(age) || age < 13) return "You must be at least 13 years old to use Sakhya.";
      if (age > 120) return "Please enter a valid date of birth.";
    }
    if (step === 3) {
      if (!gender) return "Please select an option to continue.";
    }
    if (step === 4) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Please enter a valid email address.";
    }
    if (step === 5) {
      if (password.length < 6) return "Password must be at least 6 characters.";
    }
    return null;
  }

  function goNext() {
    const validationError = validateStep();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setStep((s) => Math.min(s + 1, TOTAL_STEPS));
  }

  function goBack() {
    setError(null);
    setStep((s) => Math.max(s - 1, 1));
  }

  async function handleCreateAccount() {
    const validationError = validateStep();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await register({ firstName, lastName, dateOfBirth, gender, email, password });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-white">
            <MessageCircle size={24} />
          </div>
          <h1 className="text-xl font-semibold">Create your Sakhya account</h1>
        </div>

        {/* Progress indicator */}
        <div className="mb-5 flex items-center gap-1.5" role="progressbar" aria-valuenow={step} aria-valuemin={1} aria-valuemax={TOTAL_STEPS}>
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "h-1.5 flex-1 rounded-full transition-colors",
                i < step ? "bg-accent" : "bg-border"
              )}
            />
          ))}
        </div>

        <div className="rounded-xl border border-border bg-surface p-6">
          <div key={step} className="step-enter flex flex-col gap-4">
            <ErrorBanner message={error} />

            {step === 1 && (
              <>
                <StepHeader icon={User} title="What's your name?" subtitle="Let's get to know you." />
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="firstName" className="text-sm font-medium">
                    First name
                  </label>
                  <Input
                    id="firstName"
                    autoFocus
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Jane"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="lastName" className="text-sm font-medium">
                    Last name
                  </label>
                  <Input
                    id="lastName"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Doe"
                  />
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <StepHeader icon={Calendar} title="When's your birthday?" subtitle="This won't be shown publicly." />
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="dob" className="text-sm font-medium">
                    Date of birth
                  </label>
                  <Input
                    id="dob"
                    type="date"
                    autoFocus
                    value={dateOfBirth}
                    onChange={(e) => setDateOfBirth(e.target.value)}
                    max={new Date().toISOString().split("T")[0]}
                  />
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <StepHeader icon={Users} title="What's your gender?" subtitle="You can change this later." />
                <div className="grid grid-cols-2 gap-2">
                  {GENDER_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setGender(opt.value)}
                      className={cn(
                        "rounded-lg border px-3 py-3 text-sm font-medium transition-colors",
                        gender === opt.value
                          ? "border-accent bg-accent-soft text-accent"
                          : "border-border text-foreground hover:bg-surface-hover"
                      )}
                      aria-pressed={gender === opt.value}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </>
            )}

            {step === 4 && (
              <>
                <StepHeader icon={Mail} title="What's your email?" subtitle="We'll use this to sign you in." />
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="email" className="text-sm font-medium">
                    Email address
                  </label>
                  <Input
                    id="email"
                    type="email"
                    autoFocus
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                </div>
              </>
            )}

            {step === 5 && (
              <>
                <StepHeader icon={Lock} title="Create a password" subtitle="At least 6 characters." />
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="password" className="text-sm font-medium">
                    Password
                  </label>
                  <Input
                    id="password"
                    type="password"
                    autoFocus
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreateAccount();
                    }}
                  />
                </div>
              </>
            )}

            <div className="mt-2 flex items-center gap-2">
              {step > 1 && (
                <Button type="button" variant="outline" size="icon" onClick={goBack} aria-label="Back">
                  <ChevronLeft size={18} />
                </Button>
              )}
              {step < TOTAL_STEPS ? (
                <Button type="button" onClick={goNext} className="flex-1">
                  Next
                </Button>
              ) : (
                <Button type="button" onClick={handleCreateAccount} disabled={submitting} className="flex-1">
                  {submitting ? "Creating account..." : "Create account"}
                </Button>
              )}
            </div>
          </div>
        </div>

        <p className="mt-6 text-center text-sm text-muted">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-accent hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

function StepHeader({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: typeof User;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="mb-1 flex items-center gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
        <Icon size={18} />
      </div>
      <div>
        <h2 className="font-semibold leading-tight">{title}</h2>
        <p className="text-xs text-muted">{subtitle}</p>
      </div>
    </div>
  );
}
