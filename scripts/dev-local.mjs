#!/usr/bin/env node
// Runs the local in-memory dev API and the web dev server (pointed at it)
// together, so `npm run dev:local` is a single command. No extra dependency —
// just spawns the two workspace `dev` scripts and forwards their output. Ctrl-C
// stops both.
import { spawn } from 'node:child_process'

const port = process.env.LOCAL_API_PORT ?? '8787'
const children = []

function run(name, args, env) {
  const child = spawn('npm', args, {
    stdio: 'inherit',
    env: { ...process.env, ...env },
  })
  child.on('exit', (code) => {
    // If either half exits, tear the other down so a crash is never silent.
    for (const other of children) if (other !== child) other.kill('SIGTERM')
    process.exit(code ?? 0)
  })
  children.push(child)
  return child
}

run('api', ['run', 'dev', '--workspace', 'services/api'], { PORT: port })
run('web', ['run', 'dev', '--workspace', '@elixir-drop/web'], {
  LOCAL_API: '1',
  LOCAL_API_PORT: port,
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const child of children) child.kill('SIGTERM')
    process.exit(0)
  })
}
