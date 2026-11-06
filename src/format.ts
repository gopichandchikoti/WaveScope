export const ms = (value: number | null) => (value === null ? '—' : value.toFixed(1));
export const clock = (value: string) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
