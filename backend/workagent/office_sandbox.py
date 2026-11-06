"""Fixed-library office adapter using the document jail, with no host fallback."""
import base64
from hashlib import sha256
import json
import os
from pathlib import Path
import subprocess
from . import document_sandbox
from .errors import DomainError
from .office_models import ChartResult

FORMATS = {'docx': ('docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
           'xlsx': ('xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
           'pdf': ('pdf','application/pdf'), 'png': ('png','image/png')}
# Read-only package mounts; never mount the application/venv/home wholesale.
PACKAGES = ('pypdf','docx','openpyxl','defusedxml','lxml','et_xmlfile','typing_extensions.py',
            'reportlab','PIL','pillow.libs','charset_normalizer','matplotlib','matplotlib.libs','mpl_toolkits',
            'numpy','numpy.libs','contourpy','cycler','dateutil','fontTools','kiwisolver',
            'packaging','pyparsing','six.py')


def package_dir():
    configured = os.environ.get('WORKAGENT_OFFICE_PACKAGES')
    if configured: return Path(configured).resolve()
    candidates = sorted((Path(__file__).resolve().parents[1]/'.venv-office/lib').glob('python*/site-packages'))
    return candidates[0] if len(candidates)==1 else None


def jail_argv(input_path,module_path,kind,packages):
    if packages is None or not packages.is_dir(): raise OSError('office_dependencies_unavailable')
    # Exact installed distribution versions must match the separately pinned closure.
    from importlib.metadata import distributions
    installed={d.metadata['Name'].lower().replace('_','-'):d.version for d in distributions(path=[str(packages)])}
    lock=Path(__file__).resolve().parents[1]/'requirements-office.lock'
    for line in lock.read_text().splitlines():
        if line and not line.startswith('#'):
            name,version=line.split('==')
            if installed.get(name)!=version: raise OSError('office_dependency_pin_mismatch')
    argv = document_sandbox.jail_argv(input_path,module_path,kind,None)
    index = argv.index('--remount-ro')
    mounts = []
    for name in PACKAGES:
        source = packages/name
        if source.exists(): mounts += ['--ro-bind',str(source.resolve()),'/packages/'+name]
    for name in ('office_content.py','document_parser.py'):
        mounts += ['--ro-bind',str(Path(__file__).with_name(name).resolve()),'/packages/'+name]
    # Font discovery needs only this public configuration, never host /etc.
    if not Path('/etc/fonts').is_dir(): raise OSError('office_fonts_unavailable')
    mounts += ['--ro-bind','/etc/fonts','/etc/fonts',
               '--setenv','MPLCONFIGDIR','/tmp/matplotlib','--setenv','HOME','/tmp',
               '--setenv','OMP_NUM_THREADS','1']
    argv[index:index] = mounts
    # Fixed converter has larger but finite renderer needs than text extraction.
    argv = [a.replace('--cpu=5:5','--cpu=15:15').replace('--as=536870912:536870912','--as=1073741824:1073741824')
            .replace('--fsize=1048576:1048576','--fsize=4194304:4194304') for a in argv]
    return argv


def unique(pairs):
    result={}
    for key,value in pairs:
        if key in result: raise ValueError('duplicate key')
        result[key]=value
    return result


def convert(raw,mime_type,*,operation='render',format=None,chart_spec=None,source_omissions=()):
    input_hash=sha256(raw).hexdigest()
    job=dict(operation=operation,input=base64.b64encode(raw).decode(),input_sha256=input_hash,
             mime_type=mime_type,format=format,chart_spec=chart_spec.model_dump(mode='json') if chart_spec else None,
             source_omissions=list(source_omissions))
    try:
        code,output,errors=document_sandbox.run_confined(json.dumps(job).encode(),'office',
            module_path=Path(__file__).with_name('office_converter.py'),packages=package_dir(),
            launcher=jail_argv,wall_seconds=25,output_limit=2*1048576,input_limit=8*1048576)
        if code or errors: raise ValueError('converter unavailable or rejected input')
        value=json.loads(output,object_pairs_hook=unique)
        if (set(value)!={'version','input_sha256','output','sha256','mime_type','omissions','chart'}
                or value['version']!='office-converter-v1' or value['input_sha256']!=input_hash):
            raise ValueError('protocol')
        result=base64.b64decode(value['output'],validate=True)
        expected='application/json' if operation=='import' else FORMATS[format][1]
        if (not 0<len(result)<=1048576 or sha256(result).hexdigest()!=value['sha256'] or value['mime_type']!=expected):
            raise ValueError('output integrity')
        if operation=='import':
            from .office_content import validate
            validate(json.loads(result,object_pairs_hook=unique))
        elif ((format in ('docx','xlsx') and not result.startswith(b'PK\x03\x04'))
              or (format=='pdf' and not result.startswith(b'%PDF-'))
              or (format=='png' and not result.startswith(b'\x89PNG\r\n\x1a\n'))):
            raise ValueError('output signature')
        chart=ChartResult.model_validate(value['chart']) if value['chart'] is not None else None
        if ((format=='png') != (chart is not None) or (chart and (chart.input_sha256!=input_hash or chart.spec.model_dump()!=chart_spec.model_dump()))):
            raise ValueError('chart binding')
        omitted=value['omissions']
        if not isinstance(omitted,list) or len(omitted)>100 or any(not isinstance(v,str) or len(v)>2000 for v in omitted):
            raise ValueError('omissions')
        return result,omitted,chart
    except (OSError,ValueError,TypeError,KeyError,RecursionError,subprocess.SubprocessError,TimeoutError):
        # Never leak input filenames, stderr, document fragments or host paths.
        raise DomainError('source_unavailable') from None
