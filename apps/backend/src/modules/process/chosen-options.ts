import type { Db } from "../../db/database.ts";
import { optionsOf, type NamedOption, type Option } from "./options.ts";
import { lockOpenProcessFrom } from "./process.ts";
import type { StagePointState } from "./stage-point-coverage.ts";
import type { Stage } from "./stage.ts";


// Descarte: uma Opção viável que a Escolha deixou de lado, com o motivo. Não muda o estado da Opção.
export interface ChoiceDiscard {
  option: NamedOption;
  reason: string;
}

// Escolha: a Opção que o usuário selecionou, da Etapa B em diante, com o motivo de cada descarte.
// Trocar de Escolha é registrar uma nova; a anterior fica no histórico, superada.
export interface ChosenOption {
  id: string;
  option: NamedOption;
  discards: ChoiceDiscard[];
  chosenAt: Date;
  // Quando outra Escolha a substituiu; null na que vale.
  supersededAt: Date | null;
}

// As Escolhas do Processo, na ordem em que foram registradas; a última é a que vale.
export async function chosenOptionsOf(db: Db, processId: string): Promise<ChosenOption[]> {
  const rows = await db
    .selectFrom("chosenOptions")
    .innerJoin("options", "options.id", "chosenOptions.optionId")
    .select(["chosenOptions.id", "chosenOptions.optionId", "options.statement", "chosenOptions.chosenAt"])
    .where("chosenOptions.processId", "=", processId)
    .orderBy("chosenOptions.chosenAt")
    .orderBy("chosenOptions.id")
    .execute();
  if (rows.length === 0) return [];
  const discards = await db
    .selectFrom("choiceDiscards")
    .innerJoin("options", "options.id", "choiceDiscards.optionId")
    .select(["choiceDiscards.chosenOptionId", "choiceDiscards.optionId", "options.statement", "choiceDiscards.reason"])
    .where(
      "choiceDiscards.chosenOptionId",
      "in",
      rows.map((row) => row.id),
    )
    .orderBy("options.createdAt")
    .orderBy("options.id")
    .execute();
  return rows.map((row, index) => ({
    id: row.id,
    option: { id: row.optionId, statement: row.statement },
    discards: discards
      .filter((discard) => discard.chosenOptionId === row.id)
      .map(({ optionId, statement, reason }) => ({ option: { id: optionId, statement }, reason })),
    chosenAt: row.chosenAt,
    supersededAt: rows[index + 1]?.chosenAt ?? null,
  }));
}

// O que impede a Escolha em vigor de sustentar a Etapa B: alguma Opção aceita ainda sem decisão de
// viabilidade, nenhuma Escolha, a Opção escolhida deixou de ser viável (uma Revisão de Restrição) ou
// uma viável ficou sem motivo de descarte. Null quando a Escolha se sustenta.
export type ChoiceNotReady = "undecided_options" | "choice_required" | "chosen_option_not_viable" | "discard_reasons_required";

async function choiceProblemOf(db: Db, process: { id: string; stagePointsVersion: number }): Promise<ChoiceNotReady | null> {
  const accepted = (await optionsOf(db, process)).filter((option) => option.status === "accepted");
  if (accepted.some((option) => option.viability === "undecided")) return "undecided_options";
  const chosen = (await chosenOptionsOf(db, process.id)).at(-1);
  if (!chosen) return "choice_required";
  if (accepted.find((option) => option.id === chosen.option.id)?.viability !== "viable") return "chosen_option_not_viable";
  const discarded = new Set(chosen.discards.map((discard) => discard.option.id));
  const unjustified = othersToDiscard(accepted, chosen.option.id).some((option) => !discarded.has(option.id));
  return unjustified ? "discard_reasons_required" : null;
}

// As Opções que a Escolha precisa descartar com motivo: as outras aceitas e viáveis. As inviáveis já
// estão descartadas pela Restrição que violam.
const othersToDiscard = (accepted: Option[], chosenId: string): Option[] =>
  accepted.filter((option) => option.id !== chosenId && option.viability === "viable");

// Na Etapa B, o que a Escolha ainda segura na Confirmação da Etapa.
export async function choiceBlockingStage(db: Db, process: { id: string; stagePointsVersion: number }, stage: Stage): Promise<ChoiceNotReady | null> {
  return stage === "B" ? choiceProblemOf(db, process) : null;
}

// Os Pontos da Etapa com o da Escolha coberto ("chosen") enquanto a Escolha em vigor se sustenta.
export async function withChoiceCoverage(
  db: Db,
  process: { id: string; stagePointsVersion: number },
  states: StagePointState[],
): Promise<StagePointState[]> {
  if (!states.some((point) => point.coveredByChoice)) return states;
  const holds = (await choiceProblemOf(db, process)) === null;
  return states.map((point) => (point.coveredByChoice && holds ? { ...point, status: "chosen" } : point));
}

// O que o usuário registra: a Opção escolhida e o motivo de descarte de cada outra viável.
export interface ChoiceRequest {
  optionId: string;
  discards: { optionId: string; reason: string }[];
}

export type ChoiceError =
  | "process_not_found"
  | "process_not_open"
  | "stage_not_current"
  | "option_not_found"
  | "option_not_choosable"
  | "invalid_discards"
  | "discard_reasons_required";

export interface ChosenOptions {
  // Registra a Escolha (ou troca a que vale), da Etapa B em diante, enquanto o Processo está aberto.
  choose(processId: string, request: ChoiceRequest): Promise<{ ok: true; chosenOption: ChosenOption } | { ok: false; error: ChoiceError }>;
}

export function chosenOptions({ db }: { db: Db }): ChosenOptions {
  return {
    async choose(processId, { optionId, discards }) {
      return db.transaction().execute(async (trx) => {
        const locked = await lockOpenProcessFrom(trx, processId, "B");
        if (!locked.ok) return locked;
        const options = await optionsOf(trx, locked.process);
        const chosen = options.find((option) => option.id === optionId);
        if (!chosen) return { ok: false, error: "option_not_found" } as const;
        // Só uma Opção aceita e viável: nenhuma vantagem compensa uma Restrição violada.
        if (chosen.status !== "accepted" || chosen.viability !== "viable") return { ok: false, error: "option_not_choosable" } as const;
        const others = othersToDiscard(
          options.filter((option) => option.status === "accepted"),
          optionId,
        ).map((option) => option.id);
        const given = discards.map((discard) => discard.optionId);
        if (new Set(given).size !== given.length || given.some((id) => !others.includes(id))) return { ok: false, error: "invalid_discards" } as const;
        if (others.some((id) => !given.includes(id))) return { ok: false, error: "discard_reasons_required" } as const;
        const { id } = await trx.insertInto("chosenOptions").values({ processId, optionId }).returning("id").executeTakeFirstOrThrow();
        if (discards.length > 0) {
          await trx
            .insertInto("choiceDiscards")
            .values(discards.map((discard) => ({ chosenOptionId: id, optionId: discard.optionId, reason: discard.reason.trim() })))
            .execute();
        }
        return { ok: true, chosenOption: (await chosenOptionsOf(trx, processId)).find((item) => item.id === id)! } as const;
      });
    },
  };
}
