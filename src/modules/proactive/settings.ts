import { select } from '@utils/prompt';
import { AUTO_ALLOWED, SUGGESTION_LABELS, emptyRecord, readProactiveState, writeProactiveState } from './index';
import type { SuggestionId, SuggestionMode } from './index';

const MODE_LABELS: Record<SuggestionMode, string> = {
  ask: 'pergunta',
  auto: 'automático',
  off: 'desligada',
};

const IDS = Object.keys(SUGGESTION_LABELS) as SuggestionId[];

export async function runProactive(): Promise<void> {
  const state = await readProactiveState();

  console.log('💡 Sugestões proativas: começam perguntando; o que você sempre aceita pode virar automático, o que sempre recusa para.\n');
  console.table(
    IDS.map((id) => {
      const record = state.suggestions[id] ?? emptyRecord();
      return {
        sugestão: SUGGESTION_LABELS[id],
        modo: MODE_LABELS[record.mode],
        aceitas: record.accepted,
        recusadas: record.rejected,
        automáticas: record.autoRuns,
        'não perguntar': record.dismissed.length > 0 ? record.dismissed.join(', ') : '—',
      };
    })
  );

  const id = await select<SuggestionId | 'exit'>('Ajustar alguma?', [
    ...IDS.map((item) => ({ name: SUGGESTION_LABELS[item], value: item })),
    { name: 'Sair', value: 'exit' },
  ]);
  if (id === 'exit') return;

  const record = state.suggestions[id] ?? emptyRecord();
  type Action = SuggestionMode | 'clear' | 'cancel';
  const action = await select<Action>(`"${SUGGESTION_LABELS[id]}" (agora: ${MODE_LABELS[record.mode]})`, [
    { name: 'Perguntar', value: 'ask' },
    ...(AUTO_ALLOWED[id] ? [{ name: 'Fazer sozinho, sem perguntar', value: 'auto' as const }] : []),
    { name: 'Desligar', value: 'off' },
    ...(record.dismissed.length > 0 ? [{ name: `Voltar a perguntar sobre: ${record.dismissed.join(', ')}`, value: 'clear' as const }] : []),
    { name: 'Cancelar', value: 'cancel' },
  ]);
  if (action === 'cancel') return;

  if (action === 'clear') {
    record.dismissed = [];
  } else {
    record.mode = action;
    // a fresh start: old answers would turn it off/automatic again right away
    record.history = [];
    record.offeredAuto = action === 'auto';
  }
  state.suggestions[id] = record;
  await writeProactiveState(state);
  console.log(`✅ "${SUGGESTION_LABELS[id]}": ${action === 'clear' ? 'volta a perguntar sobre tudo' : MODE_LABELS[action]}.`);
}
