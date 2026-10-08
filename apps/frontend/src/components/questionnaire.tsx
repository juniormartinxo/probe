import { useEffect, useRef, useState } from "react";
import {
  ApiError,
  discardDraft,
  recordAnswer,
  saveDraft,
  type AnswerValue,
  type AnswerVersion,
  type Block,
  type Question,
} from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

// Quanto esperar depois da última alteração antes de guardar o rascunho.
const DRAFT_DELAY_MS = 600;

// O que está nos campos de uma Pergunta e a Versão sobre a qual a alteração começou.
interface Edit {
  value: AnswerValue;
  basedOnVersionId: string | null;
}

type Stored = Pick<AnswerVersion, "selectedChoices" | "text">;

const emptyValue = (question: Question): AnswerValue =>
  question.answerType === "free_text" ? { text: "" } : { selectedChoices: [] };

const valueOf = (question: Question, stored: Stored): AnswerValue =>
  question.answerType === "free_text" ? { text: stored.text ?? "" } : { selectedChoices: stored.selectedChoices ?? [] };

// Como a Pergunta está guardada: o rascunho, senão a resposta que vale, senão nada.
function storedEdit(question: Question): Edit {
  if (question.draft)
    return { value: valueOf(question, question.draft), basedOnVersionId: question.draft.basedOnVersionId };
  if (question.answer)
    return { value: valueOf(question, question.answer.current), basedOnVersionId: question.answer.current.id };
  return { value: emptyValue(question), basedOnVersionId: null };
}

const answeredValue = (question: Question): AnswerValue =>
  question.answer ? valueOf(question, question.answer.current) : emptyValue(question);

function sameValue(a: AnswerValue, b: AnswerValue): boolean {
  if ("text" in a && "text" in b) return a.text.trim() === b.text.trim();
  if ("selectedChoices" in a && "selectedChoices" in b) {
    const sorted = (choices: number[]) => [...choices].sort((x, y) => x - y).join(",");
    return sorted(a.selectedChoices) === sorted(b.selectedChoices);
  }
  return false;
}

function isComplete(question: Question, value: AnswerValue): boolean {
  if ("text" in value) return value.text.trim() !== "";
  return question.answerType === "single_choice"
    ? value.selectedChoices.length === 1
    : value.selectedChoices.length > 0;
}

function describe(question: Question, stored: Stored): string {
  if (stored.text !== null) return stored.text;
  return (stored.selectedChoices ?? []).map((choice) => question.choices[choice]).join("; ");
}

// Bloco de Perguntas no estilo de um questionário: uma Pergunta por vez, com navegação livre entre
// elas. O que o usuário preenche vira rascunho, guardado no servidor, até ele salvar a resposta.
export function Questionnaire({
  processId,
  block,
  onChange,
}: {
  processId: string;
  block: Block;
  onChange: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [draftFailed, setDraftFailed] = useState(false);
  const pending = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; edit: Edit }>());
  const inFlight = useRef(new Map<string, Promise<void>>());

  // Um envio por vez para cada Pergunta, na ordem: um rascunho antigo nunca chega depois de um novo.
  function persist(questionId: string, edit: Edit) {
    const previous = inFlight.current.get(questionId) ?? Promise.resolve();
    const saving = previous
      .then(() => saveDraft(processId, questionId, edit.value, edit.basedOnVersionId))
      .then(
        () => setDraftFailed(false),
        () => setDraftFailed(true),
      );
    inFlight.current.set(questionId, saving);
  }

  // Guarda já os rascunhos que esperavam a pausa na digitação. Com a página fechando, não há como
  // esperar a fila: o envio sai direto, e o navegador o completa mesmo depois de a página sumir.
  function flush({ unloading = false } = {}) {
    for (const [questionId, { timer, edit }] of pending.current) {
      clearTimeout(timer);
      if (unloading)
        saveDraft(processId, questionId, edit.value, edit.basedOnVersionId, { keepalive: true }).catch(() => {});
      else persist(questionId, edit);
    }
    pending.current.clear();
  }

  // Ao sair do Bloco ou fechar a página, nada do que foi preenchido se perde.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    const onPageHide = () => flushRef.current({ unloading: true });
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      flushRef.current();
    };
  }, []);

  // Cancela o rascunho que ia ser guardado e espera a fila do que já foi enviado, antes de salvar a
  // resposta ou descartar o rascunho; senão um envio chegaria depois e o recriaria.
  async function settleDraft(questionId: string) {
    const waiting = pending.current.get(questionId);
    if (waiting) clearTimeout(waiting.timer);
    pending.current.delete(questionId);
    await inFlight.current.get(questionId);
  }

  function edit(question: Question, value: AnswerValue) {
    const next = { value, basedOnVersionId: (edits[question.id] ?? storedEdit(question)).basedOnVersionId };
    setEdits((current) => ({ ...current, [question.id]: next }));
    const waiting = pending.current.get(question.id);
    if (waiting) clearTimeout(waiting.timer);
    const timer = setTimeout(() => {
      pending.current.delete(question.id);
      persist(question.id, next);
    }, DRAFT_DELAY_MS);
    pending.current.set(question.id, { timer, edit: next });
  }

  function go(next: number) {
    flush();
    setIndex(next);
  }

  const question = block.questions[index]!;
  const total = block.questions.length;

  return (
    <Card className="gap-4">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardDescription>
            Bloco {block.number} · Pergunta {index + 1} de {total}
          </CardDescription>
          <nav className="flex gap-1" aria-label="Perguntas do Bloco">
            {block.questions.map((item, position) => {
              const changed = !sameValue((edits[item.id] ?? storedEdit(item)).value, answeredValue(item));
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => go(position)}
                  aria-current={position === index ? "step" : undefined}
                  title={item.subject}
                  className={cn(
                    "relative flex size-7 items-center justify-center rounded-md border text-xs font-medium",
                    position === index
                      ? "bg-primary text-primary-foreground border-primary"
                      : item.answer
                        ? "bg-secondary"
                        : "text-muted-foreground",
                  )}
                >
                  {position + 1}
                  {changed && (
                    <span className="bg-primary absolute -top-1 -right-1 size-2 rounded-full" aria-label="rascunho" />
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      </CardHeader>
      <QuestionView
        key={question.id}
        processId={processId}
        question={question}
        edit={edits[question.id] ?? storedEdit(question)}
        onEdit={(value) => edit(question, value)}
        onSettled={(settled) => setEdits((current) => ({ ...current, [question.id]: settled }))}
        settleDraft={() => settleDraft(question.id)}
        onChange={onChange}
      />
      {draftFailed && (
        <p className="text-destructive px-6 text-xs">
          Não foi possível guardar o rascunho. O que você preencheu continua aqui; tente salvar a resposta.
        </p>
      )}
      <CardFooter className="justify-between">
        <Button variant="ghost" size="sm" disabled={index === 0} onClick={() => go(index - 1)}>
          ← Anterior
        </Button>
        <Button variant="ghost" size="sm" disabled={index === total - 1} onClick={() => go(index + 1)}>
          Próxima →
        </Button>
      </CardFooter>
    </Card>
  );
}

function QuestionView({
  processId,
  question,
  edit,
  onEdit,
  onSettled,
  settleDraft,
  onChange,
}: {
  processId: string;
  question: Question;
  edit: Edit;
  onEdit: (value: AnswerValue) => void;
  onSettled: (edit: Edit) => void;
  settleDraft: () => Promise<void>;
  onChange: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  // A Versão de base que o servidor recusou por já estar superada; undefined sem recusa.
  const [refusedBase, setRefusedBase] = useState<string | null>();
  const superseded = refusedBase !== undefined;
  // Só se salva sobre a Versão que vale depois que a recarga a trouxe.
  const currentId = question.answer?.current.id ?? null;
  const reloaded = superseded && currentId !== refusedBase;
  const changed = !sameValue(edit.value, answeredValue(question));

  async function save(basedOnVersionId: string | null) {
    setSaving(true);
    setError(undefined);
    try {
      await settleDraft();
      const version = await recordAnswer(processId, question.id, edit.value, basedOnVersionId);
      setRefusedBase(undefined);
      onSettled({ value: valueOf(question, version), basedOnVersionId: version.id });
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "superseded_version") setRefusedBase(basedOnVersionId);
      // O que está nos campos fica para uma nova tentativa.
      else setError("Não foi possível salvar a resposta. O que você preencheu continua aqui; tente de novo.");
    } finally {
      setSaving(false);
      onChange();
    }
  }

  async function discard() {
    setSaving(true);
    setError(undefined);
    try {
      await settleDraft();
      await discardDraft(processId, question.id);
      setRefusedBase(undefined);
      onSettled({ value: answeredValue(question), basedOnVersionId: question.answer?.current.id ?? null });
    } catch {
      setError("Não foi possível descartar o rascunho.");
    } finally {
      setSaving(false);
      onChange();
    }
  }

  return (
    <CardContent className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{question.subject}</p>
        <CardTitle className="text-base">{question.wording}</CardTitle>
        <p className="text-muted-foreground text-sm">{question.contextRelation}</p>
        {question.rationale && (
          <p className="text-muted-foreground text-xs">
            <span className="font-medium">Por que perguntamos:</span> {question.rationale}
          </p>
        )}
        <div className="flex flex-wrap gap-1">
          {question.stagePoints.map((point) => (
            <Badge key={point.key} variant="secondary">
              {point.name}
            </Badge>
          ))}
        </div>
      </div>

      <AnswerInput question={question} value={edit.value} onChange={onEdit} disabled={saving} />

      {question.answer && <SavedAnswer question={question} />}

      {superseded && (
        <div className="border-destructive/50 flex flex-col gap-2 rounded-md border p-3 text-sm">
          <p>
            Esta resposta mudou depois que você começou a alterá-la (talvez em outra aba). A Versão que vale está acima;
            o que você preencheu continua nos campos.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={saving || !reloaded} onClick={() => save(currentId)}>
              Salvar como nova Versão
            </Button>
            <Button size="sm" variant="ghost" disabled={saving} onClick={discard}>
              Descartar o que preenchi
            </Button>
          </div>
        </div>
      )}
      {error && <p className="text-destructive text-sm">{error}</p>}

      {!superseded && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {changed && (
            <span className="text-muted-foreground mr-auto text-xs">Rascunho, ainda não salvo como resposta.</span>
          )}
          {(changed || question.draft) && (
            <Button variant="ghost" size="sm" disabled={saving} onClick={discard}>
              Descartar rascunho
            </Button>
          )}
          <Button
            size="sm"
            disabled={saving || !changed || !isComplete(question, edit.value)}
            onClick={() => save(edit.basedOnVersionId)}
          >
            {saving ? "Salvando…" : question.answer ? "Salvar nova Versão" : "Salvar resposta"}
          </Button>
        </div>
      )}
    </CardContent>
  );
}

function AnswerInput({
  question,
  value,
  onChange,
  disabled,
}: {
  question: Question;
  value: AnswerValue;
  onChange: (value: AnswerValue) => void;
  disabled: boolean;
}) {
  const id = (choice: number) => `${question.id}-${choice}`;

  if ("text" in value) {
    return (
      <>
        <Label htmlFor={question.id} className="sr-only">
          Sua resposta
        </Label>
        <Textarea
          id={question.id}
          value={value.text}
          rows={4}
          disabled={disabled}
          onChange={(event) => onChange({ text: event.target.value })}
        />
      </>
    );
  }

  const selected = value.selectedChoices;
  if (question.answerType === "single_choice") {
    return (
      <RadioGroup
        value={selected[0] === undefined ? "" : String(selected[0])}
        onValueChange={(choice) => onChange({ selectedChoices: [Number(choice)] })}
        disabled={disabled}
      >
        {question.choices.map((label, choice) => (
          <div key={choice} className="flex items-center gap-2">
            <RadioGroupItem value={String(choice)} id={id(choice)} />
            <Label htmlFor={id(choice)} className="font-normal">
              {label}
            </Label>
          </div>
        ))}
      </RadioGroup>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-xs">Marque uma ou mais alternativas.</p>
      {question.choices.map((label, choice) => (
        <div key={choice} className="flex items-center gap-2">
          <Checkbox
            id={id(choice)}
            checked={selected.includes(choice)}
            disabled={disabled}
            onCheckedChange={(checked) =>
              onChange({
                selectedChoices:
                  checked === true
                    ? [...selected, choice].sort((a, b) => a - b)
                    : selected.filter((item) => item !== choice),
              })
            }
          />
          <Label htmlFor={id(choice)} className="font-normal">
            {label}
          </Label>
        </div>
      ))}
    </div>
  );
}

function SavedAnswer({ question }: { question: Question }) {
  const { current, previous } = question.answer!;
  return (
    <div className="bg-muted/50 flex flex-col gap-1 rounded-md p-3 text-sm">
      <p className="text-muted-foreground text-xs">
        Resposta salva · Versão {current.number} · {formatDate(current.createdAt)}
      </p>
      <p className="whitespace-pre-wrap">{describe(question, current)}</p>
      {previous.length > 0 && (
        <details className="text-muted-foreground text-xs">
          <summary className="cursor-pointer">Versões anteriores ({previous.length})</summary>
          <ol className="mt-2 flex flex-col gap-1">
            {previous.map((version) => (
              <li key={version.id}>
                Versão {version.number} · {formatDate(version.createdAt)}: {describe(question, version)}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
