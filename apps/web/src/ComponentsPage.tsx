import { useState, type MouseEvent, type ReactNode } from 'react';
import {
  Alert,
  Button,
  ChoiceGroup,
  DataTable,
  Dialog,
  EmptyState,
  StatusPill,
  Steps,
  SubNav,
  WIZARD_LABELS,
  WizardActions,
  type Column,
  type PillStatus,
} from './ui/index.js';
import { AuditReminder, REASON, REASON_EXAMPLES, ReasonField } from './RestoreJourney.js';
import { LongDialogExample } from './LongDialogExample.js';

/** Sections de la page, dans l'ordre du sommaire. */
export const SECTIONS = [
  { id: 'boutons', summary: 'Boutons', title: 'Boutons' },
  { id: 'champs', summary: 'Champs', title: 'Champs de formulaire' },
  { id: 'choix', summary: 'Choix', title: 'Groupe d’options' },
  { id: 'tableau', summary: 'Tableau', title: 'Tableau' },
  { id: 'dialogue', summary: 'Dialogue', title: 'Boîte de dialogue' },
  { id: 'etats', summary: 'États', title: 'États vides' },
  { id: 'alertes', summary: 'Alertes', title: 'Alertes' },
  { id: 'etapes', summary: 'Étapes', title: 'Indicateur d’étapes' },
  { id: 'actions-etapes', summary: 'Actions d’étapes', title: 'Barre d’actions des parcours' },
  { id: 'pastilles', summary: 'Pastilles', title: 'Pastilles d’état' },
  { id: 'titres', summary: 'Titres', title: 'Échelle de titres' },
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
  const [mode, setMode] = useState('copy');
  const [scope, setScope] = useState('item');
  const [open, setOpen] = useState(false);
  const [dialogReason, setDialogReason] = useState('');
  const [destructiveOpen, setDestructiveOpen] = useState(false);
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
          <Button variant="primary" aria-disabled="true">
            Principal désactivé
          </Button>
        </div>
      </Section>
      <Section id="champs" title="Champs de formulaire">
        <ReasonField
          of="de l’export"
          placeholder={REASON_EXAMPLES.export}
          value={reason}
          onChange={setReason}
        />
        <ReasonField
          of="du lancement"
          placeholder={REASON_EXAMPLES.run}
          value=""
          error={REASON.error}
          onChange={() => undefined}
        />
      </Section>
      <Section id="choix" title="Groupe d’options">
        <ChoiceGroup
          legend="Mode"
          name="demo-mode"
          value={mode}
          options={[
            { value: 'copy', label: 'Restaurer en copie (recommandé)' },
            { value: 'replace', label: 'Remplacer le fichier actuel' },
          ]}
          onChange={setMode}
        />
        <ChoiceGroup
          legend="Restaurer"
          name="demo-scope"
          value={scope}
          options={[
            { value: 'item', label: 'Un élément' },
            { value: 'site', label: 'Le site entier' },
          ]}
          onChange={setScope}
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
        <p>
          Rappel d’audit : premier bandeau d’information, sous le titre de l’étape de saisie. Il est
          retiré des boîtes de résultat et absent des actions qui ne touchent pas à un élément
          sauvegardé.
        </p>
        <Button
          variant="secondary"
          onClick={() => {
            setOpen(true);
          }}
        >
          Ouvrir l’exemple de dialogue
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            setDestructiveOpen(true);
          }}
        >
          Supprimer
        </Button>
        <LongDialogExample />
        <Dialog
          open={destructiveOpen}
          title="Supprimer cet exemple ?"
          onClose={() => {
            setDestructiveOpen(false);
          }}
        >
          <p>Confirmation destructive : le bouton qui confirme est en variante danger.</p>
          <div className="button-row dialog-actions">
            <Button
              variant="secondary"
              data-safe
              onClick={() => {
                setDestructiveOpen(false);
              }}
            >
              Annuler
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setDestructiveOpen(false);
              }}
            >
              Supprimer
            </Button>
          </div>
        </Dialog>
        <Dialog
          open={open}
          title="Exporter cette boîte ?"
          onClose={() => {
            setOpen(false);
          }}
        >
          <AuditReminder />
          <p>Indiquez le motif de l’export.</p>
          <ReasonField
            of="de l’export"
            placeholder={REASON_EXAMPLES.export}
            value={dialogReason}
            onChange={setDialogReason}
          />
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
        <Alert tone="warning" title="Sauvegardes inaccessibles">
          Le stockage ne répond pas. Prévenez un administrateur.
        </Alert>
        <Alert tone="error" title="Restauration impossible">
          Le fichier n’a pas été modifié. Réessayez plus tard.
        </Alert>
      </Section>
      <Section id="etapes" title="Indicateur d’étapes">
        <Steps steps={['Choisir', 'Vérifier', 'Confirmer']} current={1} />
        <Steps steps={['Choisir', 'Vérifier', 'Confirmer']} current={2} />
        <p>Parcours terminé : les trois étapes sont cochées, aucune n’est en cours.</p>
        <Steps steps={['Choisir', 'Vérifier', 'Confirmer']} current={4} />
      </Section>
      <Section id="actions-etapes" title="Barre d’actions des parcours">
        <p>
          Retour à gauche, action principale à droite&#x202F;; en mobile, action principale en haut.
        </p>
        <WizardActions back={<Button variant="secondary">{WIZARD_LABELS.back}</Button>}>
          <Button>{WIZARD_LABELS.next}</Button>
        </WizardActions>
        <WizardActions>
          <Button>{WIZARD_LABELS.next}</Button>
        </WizardActions>
      </Section>
      <Section id="pastilles" title="Pastilles d’état">
        <div className="button-row">
          <StatusPill status="compliant" />
          <StatusPill status="late" />
          <StatusPill status="failed" />
          <StatusPill status="running" />
          <StatusPill status="operational" />
          <StatusPill status="unconfigured" />
          <StatusPill status="pending" />
        </div>
      </Section>
      <Section id="sous-navigation" title="Sélecteur de vue (SubNav)">
        <p>
          Les entrées tiennent sur une ligne, quelle que soit la largeur : sous 900 px, leurs
          libellés passent à la ligne plutôt que d'être coupés.
        </p>
        <SubNav
          label="Exemple de sélecteur"
          links={[
            { href: '#/composants', label: 'Mails', current: false },
            { href: '#/composants', label: 'Fichiers OneDrive', current: false },
            { href: '#/composants', label: 'Sites SharePoint', current: true },
          ]}
        />
      </Section>
      <Section id="titres" title="Échelle de titres">
        <p>
          Le titre de la page (<code>h1</code>, 1,5 rem) domine&#x202F;; les parties de la page sont
          en <code>h2</code> (1,25 rem), leurs sous-parties en <code>h3</code> (1,125 rem).
        </p>
        <h3>Exemple de sous-partie</h3>
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
