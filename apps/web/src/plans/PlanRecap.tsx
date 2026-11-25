import { planSummary, type Mailbox, type PlanItem } from '../plans.js';
import { ResultList } from '../ui/index.js';

/** Le plan visé par une boîte d'action : son nom une seule fois, puis son périmètre. */
export function PlanRecap({
  plan,
  mailboxes = [],
}: {
  plan: PlanItem;
  mailboxes?: readonly Mailbox[];
}) {
  return (
    <ResultList
      rows={[
        ['Plan', plan.name],
        ['Périmètre', planSummary(plan, mailboxes)],
      ]}
    />
  );
}
