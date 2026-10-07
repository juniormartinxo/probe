import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { createProcess, listProcesses, type Process } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/format";
import { stageName, statusName } from "@/stages";

export function ProcessesPage() {
  const navigate = useNavigate();
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string>();
  const [processes, setProcesses] = useState<Process[]>();
  const [listError, setListError] = useState<string>();

  useEffect(() => {
    listProcesses().then(setProcesses, () => setListError("Não foi possível carregar os Processos."));
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    setCreateError(undefined);
    try {
      const process = await createProcess(description);
      navigate(`/processes/${process.id}`);
    } catch {
      // O texto fica no campo para uma nova tentativa.
      setCreateError("Não foi possível criar o Processo. Seu texto continua aqui; tente de novo.");
      setCreating(false);
    }
  }

  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">PROBE</h1>
        <p className="text-muted-foreground text-sm">Problema, Restrições, Opções, Balanceamento, Execução.</p>
      </header>

      <Card>
        <form onSubmit={handleSubmit} className="contents">
          <CardHeader>
            <CardTitle>Novo Processo</CardTitle>
            <CardDescription>Descreva o problema com suas palavras. O texto fica guardado exatamente como digitado.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Label htmlFor="description">Descrição do problema</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={6}
              className="min-h-32"
            />
            {createError && <p className="text-destructive text-sm">{createError}</p>}
          </CardContent>
          <CardFooter className="justify-end">
            <Button type="submit" disabled={creating || description.trim() === ""}>
              {creating ? "Criando…" : "Criar Processo"}
            </Button>
          </CardFooter>
        </form>
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Processos</h2>
        {listError && <p className="text-destructive text-sm">{listError}</p>}
        {processes?.length === 0 && <p className="text-muted-foreground text-sm">Nenhum Processo ainda.</p>}
        <ul className="flex flex-col gap-2">
          {processes?.map((process) => (
            <li key={process.id}>
              <Link
                to={`/processes/${process.id}`}
                className="hover:bg-accent flex items-start justify-between gap-4 rounded-lg border p-4 transition-colors"
              >
                <span className="line-clamp-2 text-sm whitespace-pre-wrap">{process.originalDescription}</span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <Badge variant="secondary">
                    Etapa {process.currentStage} · {stageName(process.currentStage)}
                  </Badge>
                  <span className="text-muted-foreground text-xs">
                    {statusName(process.status)} · {formatDate(process.createdAt)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
