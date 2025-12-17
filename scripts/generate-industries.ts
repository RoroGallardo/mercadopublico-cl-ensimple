import fs from 'fs/promises'
import path from 'path'

const PROCESSED_DIR = path.resolve('data/processed')
const INDUSTRIES_DIR = path.resolve('industries')

type Opportunity = {
  codigo: string
  nombre: string
  organismo: string
  fechaCierre: string
  url: string
  tipo: string
}

type OpportunitiesFile = {
  fecha: string
  [industry: string]: Opportunity[] | string
}

const INDUSTRY_META: Record<string, { title: string }> = {
  tecnologia: { title: 'Tecnología' },
  mineria: { title: 'Minería' },
  iot: { title: 'IoT' }
}

async function getLatestOpportunities(): Promise<OpportunitiesFile> {
  const files = await fs.readdir(PROCESSED_DIR)

  const targets = files
    .filter(f => f.startsWith('opportunities-') && f.endsWith('.json'))
    .sort()
    .reverse()

  if (!targets.length) {
    throw new Error('No hay opportunities generadas')
  }

  return JSON.parse(
    await fs.readFile(path.join(PROCESSED_DIR, targets[0]), 'utf-8')
  )
}

async function main() {
  const data = await getLatestOpportunities()
  const fecha = data.fecha as string

  await fs.mkdir(INDUSTRIES_DIR, { recursive: true })

  for (const [industry, meta] of Object.entries(INDUSTRY_META)) {
    const items = (data[industry] as Opportunity[]) ?? []

    const rows = items.map(o => `
| ${o.codigo} | ${o.organismo} | ${o.fechaCierre} | ${o.nombre} | [Ver](${o.url}) |
`).join('')

    const md = `
# ${meta.title}

## Oportunidades del día (${fecha})

| Código | Organismo | Cierre | Nombre | Link |
|------|----------|--------|-------|------|
${rows || '_No se detectaron oportunidades para esta industria hoy._'}

---

_Archivo generado automáticamente a partir de datos públicos de Mercado Público._
`.trim()

    await fs.writeFile(
      path.join(INDUSTRIES_DIR, `${industry}.md`),
      md
    )

    console.log(`📄 ${industry}.md generado`)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
