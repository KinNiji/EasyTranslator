import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

const Sheet = DialogPrimitive.Root;
const SheetTrigger = DialogPrimitive.Trigger;
const SheetClose = DialogPrimitive.Close;
function SheetContent({ className, children, ...props }: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return <DialogPrimitive.Portal><DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-slate-950/45" /><DialogPrimitive.Content className={cn('sheet-panel fixed inset-y-0 left-0 z-50 flex w-[min(88vw,355px)] flex-col bg-[var(--card)] p-4 text-[var(--ink)] shadow-2xl outline-none', className)} {...props}>{children}</DialogPrimitive.Content></DialogPrimitive.Portal>;
}
function SheetTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) { return <DialogPrimitive.Title className={cn('text-lg font-semibold', className)} {...props} />; }
function SheetCloseButton({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) { return <DialogPrimitive.Close className={cn('inline-grid size-9 place-items-center rounded-lg border border-[var(--line)] text-[var(--blue-dark)] hover:bg-[var(--blue-pale)]', className)} aria-label="Close" {...props}><X className="size-4" /></DialogPrimitive.Close>; }
export { Sheet, SheetClose, SheetCloseButton, SheetContent, SheetTitle, SheetTrigger };
