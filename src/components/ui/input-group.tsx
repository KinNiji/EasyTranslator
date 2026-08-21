import * as React from 'react';
import { cn } from '@/lib/utils';

export function InputGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="input-group" className={cn('flex w-full items-stretch rounded-2xl border border-[var(--line)] bg-[var(--card)] shadow-sm focus-within:ring-2 focus-within:ring-sky-300', className)} {...props} />;
}

export function InputGroupTextarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return <textarea data-slot="input-group-control" className={cn('min-h-24 min-w-0 flex-1 resize-y rounded-2xl border-0 bg-transparent px-4 py-3 text-[var(--ink)] outline-none placeholder:text-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-60', className)} {...props} />;
}

export function InputGroupAddon({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="input-group-addon" className={cn('flex items-end p-2', className)} {...props} />;
}
