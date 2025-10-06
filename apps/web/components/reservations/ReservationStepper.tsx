"use client";

interface StepperProps {
  current: number;
  steps: string[];
  onStepChange?: (index: number) => void;
}

export function ReservationStepper({ current, steps, onStepChange }: StepperProps) {
  return (
    <ol className="flex items-center gap-3 text-xs md:text-sm">
      {steps.map((label, index) => {
        const stepNumber = index + 1;
        const isActive = stepNumber === current;
        const isComplete = stepNumber < current;
        return (
          <li key={label} className="flex items-center gap-2">
            <button
              type="button"
              className={`h-6 w-6 rounded-full border transition ${
                isComplete
                  ? 'bg-primary text-primary-foreground'
                  : isActive
                  ? 'border-primary text-primary'
                  : 'text-muted-foreground'
              }`}
              onClick={() => onStepChange?.(stepNumber)}
              disabled={!onStepChange}
            >
              {stepNumber}
            </button>
            <span className={isActive ? 'font-medium' : 'text-muted-foreground'}>{label}</span>
            {index < steps.length - 1 && <span className="text-muted-foreground">→</span>}
          </li>
        );
      })}
    </ol>
  );
}
