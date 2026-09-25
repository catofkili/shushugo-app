import { startPickedStudy } from '../../../frontend/src/lib/api';
import { getDatabase } from '../../../wechat-miniprogram/src/runtime/database-store';

export function prepareFactoryWordStudy() {
  const rows = getDatabase().exec('SELECT id FROM words ORDER BY id LIMIT 24')[0]?.values ?? [];
  const ids = rows.map(([id]) => Number(id)).filter((id) => Number.isInteger(id) && id > 0);
  if (!ids.length) throw new Error('Factory fixture has no words for WordStudy.');
  const { count, session } = startPickedStudy(ids);
  if (!session.card) throw new Error(`Factory picked session returned no card (${count} words).`);
  return { count, card: session.card };
}
