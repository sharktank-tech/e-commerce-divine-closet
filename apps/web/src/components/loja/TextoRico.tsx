import Markdown from "react-markdown";

// Texto rico da loja (descrições de produto). Sem HTML cru: react-markdown
// escapa tags por padrão (sem rehype-raw), então não há vetor de XSS.
// Estilo sem plugin de tipografia (variantes arbitrárias do Tailwind).
export function TextoRico({ texto }: { texto: string }) {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-ink-soft [&>blockquote]:border-l-2 [&>blockquote]:border-accent-300 [&>blockquote]:pl-3 [&>blockquote]:italic [&>ol]:list-decimal [&>ol]:pl-5 [&>p]:m-0 [&>strong]:font-semibold [&>strong]:text-ink [&>ul]:list-disc [&>ul]:pl-5">
      <Markdown>{texto}</Markdown>
    </div>
  );
}
