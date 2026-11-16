/** Indicateur d'étapes : liste ordonnée, `aria-current="step"` sur l'étape en cours. */
export function Steps({ steps, current }: { steps: string[]; current: number }) {
  const label = steps[current - 1] ?? '';
  return (
    <div className="steps">
      <p className="steps-title">{`Étape ${current} sur ${steps.length} : ${label}`}</p>
      <ol>
        {steps.map((name, i) => {
          const n = i + 1;
          const state = n < current ? 'done' : n === current ? 'current' : 'todo';
          const icon = state === 'done' ? '✔' : state === 'current' ? '●' : '○';
          return (
            <li
              key={name}
              className={`step step-${state}`}
              aria-current={state === 'current' ? 'step' : undefined}
            >
              <span aria-hidden="true">{icon}</span> {name}
              {state === 'done' && <span className="sr-only"> (terminée)</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
