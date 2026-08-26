import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Junta classes e resolve conflitos do Tailwind.
 *
 * `clsx` monta a lista a partir de condicionais; `twMerge` decide quem vence
 * quando duas classes tocam a mesma propriedade. Sem o segundo, um
 * `cn('px-4', props.className)` com `px-2` vindo de fora gera as duas classes e o
 * resultado passa a depender da ORDEM em que o Tailwind emitiu o CSS — que não é
 * a ordem em que você escreveu. É a função que todo componente do shadcn importa.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
