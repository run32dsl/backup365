import type { Ref } from 'react';

/**
 * Indicateur d'étapes : liste ordonnée, `aria-current="step"` sur l'étape en cours. Avec
 * `titleRef`, le titre peut recevoir le focus (changement d'étape d'un parcours).
 */
export function Steps({
  steps,
  current,
  titleRef,
}: {
  steps: string[];
  current: number;
  titleRef?: Ref<HTMLParagraphElement>;
}) {
  const label = steps[current - 1] ?? '';
  return (
    <div className="steps">
      <p ref={titleRef} tabIndex={titleRef ? -1 : undefined} className="steps-title">
        {`Étape ${current} sur ${steps.length} : ${label}`}
      </p>
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
