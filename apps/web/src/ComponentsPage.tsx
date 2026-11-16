import { useState, type MouseEvent, type ReactNode } from 'react';
import {
  Alert,
  Button,
  DataTable,
  Dialog,
  EmptyState,
  FormField,
  StatusPill,
  Steps,
  type Column,
  type PillStatus,
} from './ui/index.js';

const RGPD_REMINDER =
  'Chaque consultation, export ou restauration est inscrite au journal d’audit.';

/** Sections de la page, dans l'ordre du sommaire. */
export const SECTIONS = [
  { id: 'boutons', summary: 'Boutons', title: 'Boutons' },
  { id: 'champs', summary: 'Champs', title: 'Champs de formulaire' },
  { id: 'tableau', summary: 'Tableau', title: 'Tableau' },
  { id: 'dialogue', summary: 'Dialogue', title: 'Boîte de dialogue' },
  { id: 'etats', summary: 'États', title: 'États vides' },
  { id: 'alertes', summary: 'Alertes', title: 'Alertes' },
  { id: 'etapes', summary: 'Étapes', title: 'Indicateur d’étapes' },
  { id: 'pastilles', summary: 'Pastilles', title: 'Pastilles d’état' },
] as const;

/**
 * Les ancres de l'URL portent la navigation : un lien du sommaire fait défiler jusqu'à la
 * section et lui donne le focus, sans toucher à l'ancre.
 */
export function goToSection(
  e: { preventDefault: () => void },
  id: string,
  doc: {
    getElementById: (id: string) => { scrollIntoView: () => void; focus: () => void } | null;
  } = document,
): void {
  e.preventDefault();
  const section = doc.getElementById(id);
  section?.scrollIntoView();
  section?.focus();
}

interface Sample {
  name: string;
  role: string;
  status: PillStatus;
}

const SAMPLES: Sample[] = [
  { name: 'Camille Durand', role: 'Administrateur', status: 'compliant' },
  { name: 'Alex Martin', role: 'Opérateur', status: 'failed' },
];

const COLUMNS: Column<Sample>[] = [
  { header: 'Nom', cell: (r) => r.name },
  { header: 'Rôle', cell: (r) => r.role },
  { header: 'Statut', cell: (r) => <StatusPill status={r.status} /> },
];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-titre`}>
      <h2 id={`${id}-titre`}>{title}</h2>
      <div id={id} tabIndex={-1} className="section-body">
        {children}
      </div>
    </section>
  );
}

/** Exemples d'états d'un champ et du dialogue, avec un état local. */
function Playground() {
  const [reason, setReason] = useState('Contrôle trimestriel du dossier');
  const [open, setOpen] = useState(false);
  const [dialogReason, setDialogReason] = useState('');
  const [saving, setSaving] = useState(false);
  return (
    <>
      <Section id="boutons" title="Boutons">
        <div className="button-row">
          <Button>Enregistrer</Button>
          <Button variant="secondary">Annuler</Button>
          <Button variant="danger">Supprimer</Button>
          <Button
            busy={saving}
            onClick={() => {
              setSaving(true);
              setTimeout(() => {
                setSaving(false);
              }, 2000);
            }}
          >
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
          <Button busy>Enregistrement…</Button>
          <Button disabled>Désactivé</Button>
        </div>
      </Section>
      <Section id="champs" title="Champs de formulaire">
        <FormField
          label="Motif de la consultation"
          help="Ce motif sera inscrit au journal d’audit."
          counterMax={200}
          value={reason}
          onChange={(e) => {
            setReason(e.currentTarget.value);
          }}
        />
        <FormField
          label="Motif de la consultation (en erreur)"
          error="Indiquez un motif d’au moins 10 caractères."
          counterMax={200}
          value="Test"
          readOnly
        />
      </Section>
      <Section id="tableau" title="Tableau">
        <DataTable caption="Comptes" columns={COLUMNS} rows={SAMPLES} rowKey={(r) => r.name} />
        <DataTable
          caption="Comptes (vide)"
          columns={COLUMNS}
          rows={[]}
          rowKey={(r) => r.name}
          empty={{
            message: 'Aucun compte pour l’instant.',
            action: <Button variant="secondary">Ajouter un compte</Button>,
          }}
        />
        <DataTable
          caption="Comptes (chargement)"
          columns={COLUMNS}
          rows={[]}
          rowKey={(r) => r.name}
          loading
        />
      </Section>
      <Section id="dialogue" title="Boîte de dialogue">
        <Button
          variant="secondary"
          onClick={() => {
            setOpen(true);
          }}
        >
          Ouvrir l’exemple de dialogue
        </Button>
        <Dialog
          open={open}
          title="Exporter cette boîte ?"
          onClose={() => {
            setOpen(false);
          }}
        >
          <p>Indiquez le motif de l’export.</p>
          <FormField
            label="Motif"
            counterMax={200}
            value={dialogReason}
            onChange={(e) => {
              setDialogReason(e.currentTarget.value);
            }}
          />
          <Alert tone="info">{RGPD_REMINDER}</Alert>
          <div className="button-row dialog-actions">
            <Button
              variant="secondary"
              data-safe
              onClick={() => {
                setOpen(false);
              }}
            >
              Annuler
            </Button>
            <Button
              onClick={() => {
                setOpen(false);
              }}
            >
              Exporter
            </Button>
          </div>
        </Dialog>
      </Section>
    </>
  );
}

/** Page `#/composants` : chaque composant commun dans ses états (mode démo seulement). */
export function ComponentsPage() {
  return (
    <main tabIndex={-1}>
      <h1>Composants</h1>
      <nav aria-label="Sommaire">
        <ul className="toc">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a
                href="#/composants"
                onClick={(e: MouseEvent) => {
                  goToSection(e, s.id);
                }}
              >
                {s.summary}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <Playground />
      <Section id="etats" title="États vides">
        <EmptyState action={<Button variant="secondary">Ajouter un compte</Button>}>
          Aucun compte pour l’instant.
        </EmptyState>
        <Alert tone="error" action={<Button variant="secondary">Réessayer</Button>}>
          Erreur : l’action n’a pas abouti.
        </Alert>
      </Section>
      <Section id="alertes" title="Alertes">
        <Alert tone="info">Information : la sauvegarde de ce soir démarrera à 22 h.</Alert>
        <Alert tone="success">Succès : le compte a été créé.</Alert>
        <Alert tone="warning">Avertissement : la dernière sauvegarde date de plus de 24 h.</Alert>
        <Alert tone="error">Erreur : l’action n’a pas abouti. Réessayez.</Alert>
      </Section>
      <Section id="etapes" title="Indicateur d’étapes">
        <Steps steps={['Choisir', 'Vérifier', 'Confirmer']} current={1} />
        <Steps steps={['Choisir', 'Vérifier', 'Confirmer']} current={2} />
      </Section>
      <Section id="pastilles" title="Pastilles d’état">
        <div className="button-row">
          <StatusPill status="compliant" />
          <StatusPill status="late" />
          <StatusPill status="failed" />
          <StatusPill status="running" />
        </div>
      </Section>
    </main>
  );
}

/** Page affichée hors mode démo à la place de `#/composants`. */
export function UnavailableView() {
  return (
    <main tabIndex={-1}>
      <h1>Page non disponible</h1>
      <p>
        <a href="#/">Retour à l’accueil</a>
      </p>
    </main>
  );
}
