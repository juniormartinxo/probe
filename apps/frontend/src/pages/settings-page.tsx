import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import {
  ApiError,
  getSettings,
  saveSettings,
  testConnection,
  type CloakProfile,
  type ConnectionTest,
  type Settings,
} from "@/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { attemptProblem, cloakProfileSummary, usageSummary } from "@/refinement";

// Aliases que o claude aceita; um nome completo de modelo também vale.
const modelSuggestions = ["sonnet", "opus", "haiku"];

export function SettingsPage() {
  const [saved, setSaved] = useState<Settings>();
  const [loadError, setLoadError] = useState<string>();

  // Abrir a página só lê a configuração; nenhuma chamada à IA acontece aqui.
  useEffect(() => {
    getSettings().then(setSaved, () => setLoadError("Não foi possível carregar a configuração."));
  }, []);

  return (
    <>
      <Link to="/" className="text-muted-foreground hover:text-foreground text-sm">
        ← Processos
      </Link>
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Configuração</h1>
        <p className="text-muted-foreground text-sm">
          A credencial do executor e a chave do Jev ficam no ambiente do backend e não aparecem aqui.
        </p>
      </header>
      {loadError && <p className="text-destructive text-sm">{loadError}</p>}
      {!loadError && saved === undefined && <p className="text-muted-foreground text-sm">Carregando…</p>}
      {saved !== undefined && (
        <>
          <ModelCard saved={saved} onSaved={setSaved} />
          <CloakProfileCard saved={saved} onSaved={setSaved} />
          <ConnectionCard saved={saved} />
        </>
      )}
    </>
  );
}

// Cada cartão salva a configuração inteira: a sua parte como está no campo, a do outro como está salva.
interface SettingsCardProps {
  saved: Settings;
  onSaved: (settings: Settings) => void;
}

function ModelCard({ saved: savedSettings, onSaved }: SettingsCardProps) {
  const savedModel = savedSettings.claudeModel;
  const [model, setModel] = useState(savedModel);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const changed = model.trim() !== savedModel;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(undefined);
    setSaved(false);
    try {
      const settings = await saveSettings({ ...savedSettings, claudeModel: model.trim() });
      onSaved(settings);
      setModel(settings.claudeModel);
      setSaved(true);
    } catch (caught) {
      // O texto fica no campo para corrigir ou tentar de novo.
      setError(
        caught instanceof ApiError && caught.code === "invalid_model"
          ? "Modelo inválido. Use um alias, como sonnet, ou o nome completo do modelo, sem espaços."
          : "Não foi possível salvar. Seu texto continua aqui; tente de novo.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="contents">
        <CardHeader>
          <CardTitle>Modelo do claude</CardTitle>
          <CardDescription>
            Vale para as próximas chamadas à IA, inclusive novas tentativas. Cada tentativa já feita mantém a CLI e o
            modelo que usou.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Label htmlFor="claude-model">Modelo</Label>
          <Input
            id="claude-model"
            list="claude-model-suggestions"
            value={model}
            onChange={(event) => {
              setModel(event.target.value);
              setSaved(false);
            }}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={error !== undefined}
          />
          <datalist id="claude-model-suggestions">
            {modelSuggestions.map((suggestion) => (
              <option key={suggestion} value={suggestion} />
            ))}
          </datalist>
          <p className="text-muted-foreground text-xs">Um alias, como sonnet, opus ou haiku, ou o nome completo do modelo.</p>
          {error && <p className="text-destructive text-sm">{error}</p>}
          {saved && <p className="text-muted-foreground text-sm">Modelo salvo.</p>}
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" disabled={saving || !changed || model.trim() === ""}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function CloakProfileCard({ saved: savedSettings, onSaved }: SettingsCardProps) {
  const savedProfile = savedSettings.cloakProfile;
  const [choice, setChoice] = useState<CloakProfile["source"]>(savedProfile.source);
  const [name, setName] = useState(savedProfile.source === "explicit" ? savedProfile.name : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const requested = choice === "directory" ? { source: "directory" as const } : { source: "explicit" as const, name: name.trim() };
  const changed =
    requested.source !== savedProfile.source ||
    (requested.source === "explicit" && savedProfile.source === "explicit" && requested.name !== savedProfile.name);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(undefined);
    setSaved(false);
    try {
      const settings = await saveSettings({ ...savedSettings, cloakProfile: requested });
      onSaved(settings);
      setSaved(true);
    } catch (caught) {
      // A escolha fica nos campos para corrigir ou tentar de novo.
      setError(
        caught instanceof ApiError && caught.code === "invalid_cloak_profile"
          ? "Nome de perfil inválido. Use letras, dígitos, ponto, hífen ou sublinhado, sem espaços."
          : "Não foi possível salvar. Sua escolha continua aqui; tente de novo.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="contents">
        <CardHeader>
          <CardTitle>Perfil do Cloak</CardTitle>
          <CardDescription>
            O executor chama o claude pelo Cloak, com as contas e credenciais do perfil. Vale para as próximas chamadas à
            IA; cada tentativa já feita mantém o perfil que usou.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <RadioGroup
            value={choice}
            onValueChange={(value) => {
              setChoice(value as CloakProfile["source"]);
              setSaved(false);
            }}
          >
            <div className="flex items-start gap-2">
              <RadioGroupItem value="directory" id="cloak-profile-directory" className="mt-0.5" />
              <Label htmlFor="cloak-profile-directory" className="flex flex-col items-start gap-1 font-normal">
                Perfil do diretório
                <span className="text-muted-foreground text-xs">
                  O que o Cloak liga ao diretório de trabalho do executor (cloak use), ou o perfil padrão dele.
                </span>
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="explicit" id="cloak-profile-explicit" />
              <Label htmlFor="cloak-profile-explicit" className="font-normal">
                Outro perfil
              </Label>
            </div>
          </RadioGroup>
          {choice === "explicit" && (
            <div className="flex flex-col gap-2 pl-6">
              <Label htmlFor="cloak-profile-name">Nome do perfil</Label>
              <Input
                id="cloak-profile-name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setSaved(false);
                }}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={error !== undefined}
              />
              <p className="text-muted-foreground text-xs">Como aparece em cloak profile list.</p>
            </div>
          )}
          {error && <p className="text-destructive text-sm">{error}</p>}
          {saved && <p className="text-muted-foreground text-sm">Perfil salvo.</p>}
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" disabled={saving || !changed || (choice === "explicit" && name.trim() === "")}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function ConnectionCard({ saved }: { saved: Settings }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ConnectionTest>();
  const [error, setError] = useState<string>();

  async function handleTest() {
    setTesting(true);
    setResult(undefined);
    setError(undefined);
    try {
      setResult(await testConnection());
    } catch {
      setError("Não foi possível falar com o backend para testar a conexão.");
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Conexão</CardTitle>
        <CardDescription>
          Pede uma resposta curta ao claude, pelo executor, com o modelo ({saved.claudeModel}) e o perfil do Cloak (
          {cloakProfileSummary(saved.cloakProfile)}) salvos. É uma chamada paga e só acontece quando você clica.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {testing && <p className="text-muted-foreground text-sm">Testando a conexão…</p>}
        {result && <ConnectionResult result={result} />}
        {error && <p className="text-destructive text-sm">{error}</p>}
      </CardContent>
      <CardFooter className="justify-end">
        <Button variant="outline" disabled={testing} onClick={handleTest}>
          {testing ? "Testando…" : "Testar conexão"}
        </Button>
      </CardFooter>
    </Card>
  );
}

function ConnectionResult({ result }: { result: ConnectionTest }) {
  const used = `${result.cli} · ${result.model} · ${cloakProfileSummary(result.cloakProfile)} · ${usageSummary(result.usage)}`;
  if (result.status === "completed") {
    return (
      <div className="flex flex-col gap-1 rounded-lg border p-4">
        <p className="text-sm">A conexão está funcionando.</p>
        <p className="text-muted-foreground text-xs">{used}</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-4">
      <p className="text-sm">{attemptProblem(result)}</p>
      {result.message && <p className="text-muted-foreground text-xs whitespace-pre-wrap">{result.message}</p>}
      <p className="text-muted-foreground text-xs">{used}</p>
    </div>
  );
}
