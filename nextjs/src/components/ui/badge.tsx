import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/core/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-[#0078D4] text-white shadow-xs hover:bg-[#106EBE]",
        secondary:
          "border-transparent bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 hover:bg-slate-200",
        destructive:
          "border-transparent bg-red-500 text-white shadow-xs hover:bg-red-600",
        outline: "text-slate-950 dark:text-slate-50 border-slate-300 dark:border-slate-700",
        success:
          "border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
        warning:
          "border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20",
        info:
          "border-transparent bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/20",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
