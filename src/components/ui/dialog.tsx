import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

function DialogContent({ className, children, ...props }: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return <DialogPrimitive.Portal><DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-slate-950/45" /><DialogPrimitive.Content className={cn('dialog-panel fixed inset-x-4 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-auto -translate-y-1/2 overflow-y-auto rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5 text-[var(--ink)] shadow-2xl outline-none sm:left-1/2 sm:w-full sm:max-w-xl sm:-translate-x-1/2', className)} {...props}>{children}</DialogPrimitive.Content></DialogPrimitive.Portal>;
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) { return <div className={cn('mb-4 flex items-center justify-between gap-3', className)} {...props} />; }
function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) { return <DialogPrimitive.Title className={cn('text-lg font-semibold', className)} {...props} />; }
function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) { return <DialogPrimitive.Description className={cn('text-sm text-[var(--muted)]', className)} {...props} />; }
function DialogCloseButton({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) { return <DialogPrimitive.Close className={cn('inline-grid size-9 place-items-center rounded-lg border border-[var(--line)] text-[var(--blue-dark)] hover:bg-[var(--blue-pale)]', className)} aria-label="Close" {...props}><X className="size-4" /></DialogPrimitive.Close>; }

export { Dialog, DialogClose, DialogCloseButton, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger };
