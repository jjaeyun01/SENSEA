export type VoiceCommand =
  | { type: 'confirm' }
  | { type: 'cancel' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'repeat' }
  | { type: 'select-route'; routeNumber: number }
  | { type: 'unknown'; transcript: string };

export function parseVoiceCommand(transcript: string): VoiceCommand {
  const normalized = transcript.trim().toLocaleLowerCase('ko-KR').replaceAll(' ', '');

  if (['네', '예', '맞아', '확인'].includes(normalized)) return { type: 'confirm' };
  if (['아니요', '아니오', '취소'].includes(normalized)) return { type: 'cancel' };
  if (['일시정지', '멈춰', '정지'].includes(normalized)) return { type: 'pause' };
  if (['계속', '재개', '시작'].includes(normalized)) return { type: 'resume' };
  if (['다시', '다시말해줘', '반복'].includes(normalized)) return { type: 'repeat' };

  const routeMatch = normalized.match(/^(?:경로)?([1-9])번?$/);
  if (routeMatch?.[1]) {
    return { type: 'select-route', routeNumber: Number(routeMatch[1]) };
  }

  return { type: 'unknown', transcript };
}

