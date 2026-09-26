"""Fast local pronunciation preview; does not load or run a singing model."""
import json
import sys
from pathlib import Path
import yaml
from pypinyin import lazy_pinyin, Style

def prepare(text, overrides=None):
    if len(text)!=8 or not all('\u3400'<=c<='\u9fff' for c in text):
        raise ValueError('请填写 8 个中文汉字，以保持原来的旋律和节奏。')
    bank=Path(__file__).resolve().parents[1]/'.local/score-trial/voicebank'
    dictionary=yaml.safe_load((bank/'dsdur/dsdict-zh.yaml').read_text(encoding='utf-8'))
    allowed={entry['grapheme'] for entry in dictionary['entries']}
    pinyin=overrides if overrides is not None else lazy_pinyin(text,style=Style.NORMAL,v_to_u=False)
    if not isinstance(pinyin,list) or len(pinyin)!=8 or not all(isinstance(p,str) and p in allowed for p in pinyin):
        raise ValueError('有拼音暂不受此声库支持，请检查拼音或换一个字。')
    return {'lyrics':text,'pinyin':pinyin,'characters':list(text)}

if __name__=='__main__':
    try:
        request=json.load(sys.stdin)
        print(json.dumps(prepare(request['lyrics'],request.get('pinyin')),ensure_ascii=False))
    except (ValueError,KeyError) as error:
        print(json.dumps({'error':str(error)},ensure_ascii=False))
        sys.exit(2)
