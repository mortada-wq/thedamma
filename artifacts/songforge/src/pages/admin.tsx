import { useState, useEffect } from "react";
import { useGetAdminSettings, useUpdateAdminSettings } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Save, Check, AlertCircle } from "lucide-react";
import { Link } from "wouter";

type Provider = "gemini" | "claude" | "deepseek" | "siliconflow";

const PROVIDERS: {
  id: Provider;
  label: string;
  description: string;
  defaultModel: string;
  envVar?: string;
  supportsAudio: boolean;
}[] = [
  {
    id: "gemini",
    label: "Gemini",
    description: "Google Gemini via Replit proxy — no API key required.",
    defaultModel: "gemini-2.0-flash",
    supportsAudio: true,
  },
  {
    id: "claude",
    label: "Claude",
    description: "Anthropic Claude via Replit proxy — no API key required.",
    defaultModel: "claude-sonnet-4-6",
    supportsAudio: false,
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    description: "DeepSeek API — requires DEEPSEEK_API_KEY environment secret.",
    defaultModel: "deepseek-chat",
    envVar: "DEEPSEEK_API_KEY",
    supportsAudio: false,
  },
  {
    id: "siliconflow",
    label: "Silicon Flow",
    description: "SiliconFlow API — requires SILICON_FLOW_API_KEY environment secret.",
    defaultModel: "deepseek-ai/DeepSeek-V3",
    envVar: "SILICON_FLOW_API_KEY",
    supportsAudio: false,
  },
];

export function Admin() {
  const { toast } = useToast();
  const { data, isLoading } = useGetAdminSettings();
  const update = useUpdateAdminSettings();

  const [provider, setProvider] = useState<Provider>("gemini");
  const [model, setModel] = useState("gemini-2.0-flash");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) {
      setProvider(data.activeProvider as Provider);
      setModel(data.activeModel);
    }
  }, [data]);

  const handleProviderChange = (p: Provider) => {
    setProvider(p);
    const def = PROVIDERS.find((x) => x.id === p)?.defaultModel ?? "";
    setModel(def);
    setSaved(false);
  };

  const handleSave = async () => {
    try {
      await update.mutateAsync({ data: { activeProvider: provider, activeModel: model } });
      setSaved(true);
      toast({ title: "Settings saved", description: `Now using ${label} / ${model}` });
      setTimeout(() => setSaved(false), 3000);
    } catch {
      toast({ title: "Save failed", description: "Could not update settings.", variant: "destructive" });
    }
  };

  const current = PROVIDERS.find((p) => p.id === provider)!;
  const label = PROVIDERS.find((p) => p.id === provider)?.label ?? provider;

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="h-8 w-48 bg-secondary/50 rounded animate-pulse mb-6" />
        <div className="h-64 bg-secondary/30 rounded-2xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-4 mb-8">
        <Link href="/">
          <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground rounded-full">
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Admin Settings</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Configure the AI provider used for song analysis</p>
        </div>
      </div>

      <div className="space-y-6">
        <div>
          <Label className="text-sm font-medium text-foreground mb-3 block">AI Provider</Label>
          <div className="grid grid-cols-2 gap-3">
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                onClick={() => handleProviderChange(p.id)}
                className={`text-left p-4 rounded-xl border transition-all ${
                  provider === p.id
                    ? "border-brand-blue bg-brand-blue/10 text-foreground"
                    : "border-border bg-card text-muted-foreground hover:border-border/80 hover:bg-secondary/40"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className={`font-medium text-sm ${provider === p.id ? "text-brand-blue" : "text-foreground"}`}>
                    {p.label}
                  </span>
                  {p.supportsAudio ? (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/20">
                      audio
                    </span>
                  ) : (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border">
                      text
                    </span>
                  )}
                </div>
                <p className="text-xs leading-relaxed">{p.description}</p>
              </button>
            ))}
          </div>
        </div>

        {!current.supportsAudio && (
          <div className="flex gap-3 p-3 rounded-xl border border-amber-500/20 bg-amber-500/5">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-300 leading-relaxed">
              <strong>{current.label}</strong> does not support audio analysis. YouTube links and uploaded files will
              still be processed, but analysis will be based on training knowledge rather than the actual audio.
            </p>
          </div>
        )}

        {current.envVar && (
          <div className="flex gap-3 p-3 rounded-xl border border-border bg-card">
            <AlertCircle className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              This provider requires the <code className="font-mono bg-secondary px-1 py-0.5 rounded text-foreground">{current.envVar}</code> environment
              secret to be configured in the Replit Secrets panel before use.
            </p>
          </div>
        )}

        <div>
          <Label htmlFor="model-input" className="text-sm font-medium text-foreground mb-2 block">
            Model name
          </Label>
          <Input
            id="model-input"
            value={model}
            onChange={(e) => { setModel(e.target.value); setSaved(false); }}
            placeholder="e.g. gemini-2.0-flash"
            className="font-mono text-sm bg-card border-border focus:border-brand-blue/60"
          />
          <p className="text-xs text-muted-foreground mt-1.5">
            Default for {current.label}: <code className="font-mono">{current.defaultModel}</code>
          </p>
        </div>

        <div className="pt-2">
          <Button
            onClick={handleSave}
            disabled={update.isPending || !model.trim()}
            className="gap-2 rounded-full bg-brand-blue hover:bg-brand-blue/90 text-white font-medium px-6"
          >
            {saved ? (
              <><Check className="w-4 h-4" /> Saved</>
            ) : update.isPending ? (
              "Saving..."
            ) : (
              <><Save className="w-4 h-4" /> Save settings</>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
