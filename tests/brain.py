"""Dependency-free routing tests; no Flask/requests installation or phone needed."""
import ast
import re
import time
from pathlib import Path
from types import SimpleNamespace

source = ast.parse((Path(__file__).resolve().parents[1] / 'brain/daemon_brain_v4.py').read_text())
functions = [node for node in source.body if isinstance(node, ast.FunctionDef) and node.name in ('get_intent', 'process_command')]
for node in functions:
    node.decorator_list = []
seen = []
request = SimpleNamespace(get_json=lambda **kwargs: {'prompt': current})
namespace = dict(re=re, time=time, request=request, jsonify=lambda value: value,
                 TOKEN_CEILING=dict(word=500, excel=300, ppt=700, vscode=600, notepad=300, canva=15),
                 generate_text=lambda prompt, ceiling: seen.append(prompt) or 'Model reply')
exec(compile(ast.fix_missing_locations(ast.Module(body=functions, type_ignores=[])), '<brain routing>', 'exec'), namespace)
chat = ['Hello Qwen!', 'Why is the Sky Blue?', 'Please note that I am busy', 'Explain Python code', 'Can you make Python easier to understand?', 'Provide information about Python',
        'What is a spreadsheet?', 'How do I create a Word document?', 'Explain how to write code',
        'Write a short reply about Python', 'Write an explanation of Python code', 'I used to write Python code', 'I do not want to create a document', 'Do not create a document', 'Can you explain this presentation?']
files = {'Write Python code for MyProject': 'vscode', 'Give me a Python script for hiking': 'vscode', 'Create a CSV for Budget': 'excel',
         'Draft a Word document about History': 'word', 'Create a presentation about Birds': 'ppt',
         'Design a poster for school': 'canva', 'Write notes about Meeting': 'notepad',
         'Save this as a text file': 'notepad'}
for current in chat + list(files):
    expected = files.get(current, 'chat')
    assert namespace['get_intent'](current) == expected, current
    result = namespace['process_command']()
    assert result['action'] == ('chat' if expected == 'chat' else 'automate_' + expected), current
    assert current in seen[-1], (current, seen[-1])
    if expected == 'chat':
        assert seen[-1] == current and result['filename'] == ''
print('Brain: chat/default routing, explicit artifact intents, response schema and original prompt case passed.')
