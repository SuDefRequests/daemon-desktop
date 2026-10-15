"""Dependency-free routing tests; no Flask/requests installation or phone needed."""
import ast
import re
import time
from pathlib import Path
from types import SimpleNamespace

source = ast.parse((Path(__file__).resolve().parents[1] / 'brain/daemon_brain_v4.py').read_text())
functions = [node for node in source.body if isinstance(node, ast.FunctionDef) and node.name in ('get_code_language', 'get_intent', 'process_command', 'health')]
for node in functions:
    node.decorator_list = []
seen = []
request = SimpleNamespace(get_json=lambda **kwargs: {'prompt': current})
namespace = dict(re=re, time=time, request=request, jsonify=lambda value: value,
                 TOKEN_CEILING=dict(word=500, excel=300, ppt=700, vscode=600, notepad=300, canva=15),
                 generate_text=lambda prompt, ceiling, status=None: seen.append(prompt) or 'Model reply')
constants = [node for node in source.body if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id in ('CODE_LANGUAGES', 'UNSUPPORTED_CODE_LANGUAGES', 'CODE_LANGUAGE_PATTERN') for target in node.targets)]
exec(compile(ast.fix_missing_locations(ast.Module(body=constants + functions, type_ignores=[])), '<brain routing>', 'exec'), namespace)
chat = ['Hello Qwen!', 'Why is the Sky Blue?', 'Please note that I am busy', 'Explain Python code', 'Can you make Python easier to understand?', 'Provide information about Python',
        'What is a spreadsheet?', 'How do I create a Word document?', 'Explain how to write code',
        'Write a short reply about Python', 'Write an explanation of Python code', 'I used to write Python code', 'I do not want to create a document', 'Do not create a document', 'Can you explain this presentation?',
        'Who is Virat Kohli?', 'What is a Word file?', 'How do I write an essay?', 'Explain environmental management', 'Please note that I read a report today']
files = {'Write Python code for MyProject': 'vscode', 'Give me a Python script for hiking': 'vscode', 'Create a CSV for Budget': 'excel',
         'Draft a Word document about History': 'word', 'Create a presentation about Birds': 'ppt',
         'Design a poster for school': 'canva', 'Write notes about Meeting': 'notepad',
         'Save this as a text file': 'notepad', 'create a word file for virat kohli': 'word',
         'create a Word document about Virat Kohli': 'word', 'make a Word file': 'word',
         'write an essay on environmental management': 'word', 'prepare a report about recycling': 'word',
         'write a report as a Word document about recycling': 'word'}
for current in chat + list(files):
    expected = files.get(current, 'chat')
    assert namespace['get_intent'](current) == expected, current
    result = namespace['process_command']()
    assert result['action'] == ('chat' if expected == 'chat' else 'automate_' + expected), current
    assert current in seen[-1], (current, seen[-1])
    if expected == 'chat':
        assert seen[-1] == current and result['filename'] == ''
print('Brain: chat/default routing, explicit artifact intents, response schema and original prompt case passed.')

assert namespace["health"]() == {"service": "vidur-brain", "status": "ok"}

cases = [
    ("python", ".py", "Write a Python program to sort an array"),
    ("javascript", ".js", "Write a JavaScript function to reverse a string"),
    ("typescript", ".ts", "Write a TypeScript function for a total"),
    ("c", ".c", "Write a C program for a sum"),
    ("cpp", ".cpp", "Create a C++ program for binary search"),
    ("java", ".java", "Create a Java class for a student record"),
    ("html", ".html", "Create a basic HTML page"),
    ("html", ".html", "Create an HTML table"),
    ("html", ".html", "Write an HTML document"),
    ("css", ".css", "Create a CSS stylesheet for a card"),
    ("rust", ".rs", "Write a Rust program for a total"),
    ("go", ".go", "Write a Go program for a sum"),
    ("shell", ".sh", "Write a Bash script to list files"),
    ("javascript", ".js", "In JavaScript, write code to reverse a string"),
    ("javascript", ".js", 'Write a script in JavaScript to print "Python code"'),
    ("typescript", ".ts", "Write code to sort an array using TypeScript"),
    ("cpp", ".cpp", "Write code in C++ rather than Python"),
    ("html", ".html", "Create a page in HTML"),
    ("css", ".css", "Create a stylesheet using CSS"),
    ("go", ".go", "Create a Python parser in Go"),
    ("python", ".py", "Write a program to go through a list"),
    ("python", ".py", "Write some simple code"),
    ("javascript", ".js", "Write code in 'JavaScript'"),
    ("typescript", ".ts", "Create a file called example.ts"),
]
model_output = '  // Keep original backticks and whitespace\nconst value = `literal ``` text`;\n'
namespace['generate_text'] = lambda prompt, ceiling: seen.append(prompt) or model_output
for language, extension, current in cases:
    assert namespace['get_intent'](current) == 'vscode', current
    assert namespace['get_code_language'](current) == language, current
    result = namespace['process_command']()
    assert result['action'] == 'automate_vscode', (current, result)
    assert result['language'] == language and result['filename'].endswith(extension), result
    assert result['content'] == model_output
    assert seen[-1].startswith('Write simple ' + namespace['CODE_LANGUAGES'][language][0] + ' code for: ')
    assert current in seen[-1]
for current in ['What is Python?', 'Explain JavaScript functions', 'What is C++?',
                'Write a report about Java code', 'Write notes about Rust programs',
                'Write an explanation of HTML pages']:
    assert namespace['get_intent'](current) != 'vscode', current
for current in ['Write code in JavaScript or TypeScript', 'Write Java or Python code',
                'Write C# code', 'Write Ruby code', 'Write code using PowerShell', 'Write code in Elixir', 'Write Elixir code']:
    calls = len(seen)
    result = namespace['process_command']()
    assert result['action'] == 'chat' and result['filename'] == '', (current, result)
    assert 'choose one supported' in result['content'] and len(seen) == calls
print('Brain: all eleven languages, request-context detection, metadata/extensions, original content and ambiguity/unsupported-language clarification passed.')

# Exercise the real request/metadata adapter with a local stub, not llama-server.
adapter = next(node for node in source.body if isinstance(node, ast.FunctionDef) and node.name == 'generate_text')
fake_requests = SimpleNamespace(post=lambda *args, **kwargs: SimpleNamespace(json=lambda: completion),
    exceptions=SimpleNamespace(Timeout=TimeoutError, ConnectionError=ConnectionError))
adapter_namespace = dict(time=time, requests=fake_requests, LLAMA_SERVER_URL='http://127.0.0.1:8080/completion', REQUEST_TIMEOUT=240)
exec(compile(ast.fix_missing_locations(ast.Module(body=[adapter], type_ignores=[])), '<brain adapter>', 'exec'), adapter_namespace)
for flags, expected in [({'stop_type': 'limit'}, 'partial'), ({'stopped_limit': True}, 'partial'),
                        ({'stop_type': 'eos'}, 'complete'), ({'stop_type': 'word'}, 'complete'),
                        ({'stopped_eos': True}, 'complete'), ({'truncated': True, 'stop_type': 'eos'}, 'partial'), ({}, 'unknown')]:
    completion = dict(content='Returned model script.', **flags)
    status = {}
    assert adapter_namespace['generate_text']('Original prompt', 700, status) == completion['content']
    assert status['state'] == expected
    assert adapter_namespace['generate_text']('Original prompt', 700) == completion['content']
current = 'Create a presentation about recycling'
namespace['generate_text'] = lambda prompt, ceiling, status: status.update(state='partial') or 'Usable partial script'
result = namespace['process_command']()
assert result['generation_status'] == 'partial' and result['content'] == 'Usable partial script'
print('Brain: presentation completion metadata, legacy unknown status and unchanged text callers passed.')
