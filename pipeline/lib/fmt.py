# Компактный JSON для сцен: объект на строку, вложенные массивы чисел в одну строку
import json, sys

def dump(v, ind=0):
    pad = '  ' * ind
    if isinstance(v, dict):
        flat = json.dumps(v, ensure_ascii=False)
        if len(flat) <= 150 or ind >= 2:
            return flat
        items = [f'{pad}  {json.dumps(k, ensure_ascii=False)}: {dump(x, ind + 1)}' for k, x in v.items()]
        return '{\n' + ',\n'.join(items) + f'\n{pad}}}'
    if isinstance(v, list):
        flat = json.dumps(v, ensure_ascii=False)
        if len(flat) <= 110 or all(not isinstance(x, (dict, list)) for x in v):
            return flat
        return '[\n' + ',\n'.join(f'{pad}  {dump(x, ind + 1)}' for x in v) + f'\n{pad}]'
    return json.dumps(v, ensure_ascii=False)

for f in sys.argv[1:]:
    d = json.load(open(f))
    open(f, 'w').write(dump(d) + '\n')
