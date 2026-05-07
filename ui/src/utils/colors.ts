export const RANK_COLORS: Record<string, string> = {
  domain:          'red',
  superkingdom:    'red-darken-2',
  kingdom:         'pink',
  subkingdom:      'pink-darken-2',
  superphylum:     'purple-lighten-2',
  phylum:          'purple',
  subphylum:       'purple-darken-2',
  superclass:      'indigo-lighten-2',
  class:           'indigo',
  subclass:        'indigo-darken-2',
  superorder:      'blue-lighten-2',
  order:           'blue',
  suborder:        'blue-darken-2',
  superfamily:     'cyan-lighten-2',
  family:          'cyan',
  subfamily:       'cyan-darken-2',
  tribe:           'teal-lighten-2',
  genus:           'teal',
  subgenus:        'teal-darken-2',
  'species group': 'green-lighten-2',
  species:         'green',
  subspecies:      'light-green',
  strain:          'lime',
  varietas:        'amber',
  forma:           'orange',
}

export function rankColor(rank: string): string {
  return RANK_COLORS[rank.toLowerCase()] ?? 'grey'
}
