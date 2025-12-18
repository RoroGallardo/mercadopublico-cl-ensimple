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
  tecnologia?: Opportunity[]
  mineria?: Opportunity[]
  iot?: Opportunity[]
}

const INDUSTRY_META: Record<string, { title: string }> = {
  tecnologia: { title: 'Tecnología' },
  mineria: { title: 'Minería' },
  iot: { title: 'IoT / Automatización' }
}

/* -------------------------
   Helpers gráficos
-------------------------- */

function chartUrl(config: object): string {
  return `https://quickchart.io/chart?width=700&height=350&c=${encodeURIComponent(
    JSON.stringify(config)
  )}`
}

function buildClosingDatesChart(items: Opportunity[]) {
  const counts: Record<string, number> = {}

  for (const o of items) {
    counts[o.fechaCierre] = (counts[o.fechaCierre] || 0) + 1
  }

  const labels = Object.keys(counts).sort()
  const data = labels.map(l => counts[l])

  return chartUrl({
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Oportunidades',
          data
        }
      ]
    }
  })
}

async function buildTrendChart(industry: string) {
  const files = (await fs.readdir(PROCESSED_DIR))
    .filter(f => f.startsWith('opportunities-'))
    .sort()
    .slice(-7)

  const labels: string[] = []
  const data: number[] = []

  for (const f of files) {
    const json = JSON.parse(
      await fs.readFile(path.join(PROCESSED_DIR, f), 'utf-8')
    )
    labels.push(json.fecha)
    data.push(json[industry]?.length ?? 0)
  }

  return chartUrl({
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Oportunidades por día',
          data,
          fill: false
        }
      ]
    }
  })
}

function buildBuyersChart(items: Opportunity[]) {
  const counts: Record<string, number> = {}

  for (const o of items) {
    counts[o.organismo] = (counts[o.organismo] || 0) + 1
  }

  const top = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)

  return chartUrl({
    type: 'bar',
    data: {
      labels: top.map(([k]) => k),
      datasets: [
        {
          label: 'Cantidad de oportunidades',
          data: top.map(([, v]) => v)
        }
      ]
    }
  })
}

/* -------------------------
   Carga de datos
-------------------------- */

async function getLatestOpportunities(): Promise<OpportunitiesFile> {
  const files = await fs.readdir(PROCESSED_DIR)

  const target = files
    .filter(f => f.startsWith('opportunities-') && f.endsWith('.json'))
    .sort()
    .reverse()[0]

  if (!target) {
    throw new Error('No hay archivos de oportunidades procesadas')
  }

  return JSON.parse(
    await fs.readFile(path.join(PROCESSED_DIR, target), 'utf-8')
  )
}

/* -------------------------
   Main
-------------------------- */

async function main() {
  const data = await getLatestOpportunities()
  const fecha = data.fecha

  await fs.mkdir(INDUSTRIES_DIR, { recursive: true })

  for (const [industry, meta] of Object.entries(INDUSTRY_META)) {
    const items: Opportunity[] = (data as any)[industry] ?? []

    const rows = items
      .map(
        o =>
          `| ${o.codigo} | ${o.organismo} | ${o.fechaCierre} | ${o.nombre} | [Ver](${o.url}) |`
      )
      .join('\n')

    const closingChart = buildClosingDatesChart(items)
    const trendChart = await buildTrendChart(industry)
    const buyersChart = buildBuyersChart(items)

    const md = `
# ${meta.title}

## Oportunidades del día (${fecha})

| Código | Organismo | Cierre | Nombre | Link |
|--------|-----------|--------|--------|------|
${rows || '_No se detectaron oportunidades para esta industria hoy._'}

---

## Analítica diaria

### Distribución por fecha de cierre
![Distribución por fecha de cierre](${closingChart})

### Evolución diaria (últimos 7 días)
![Evolución diaria](${trendChart})

### Principales organismos compradores
![Organismos compradores](${buyersChart})

---

_Listado y analítica generados automáticamente a partir de datos públicos de Mercado Público._
`.trim()

    await fs.writeFile(
      path.join(INDUSTRIES_DIR, `${industry}.md`),
      md
    )

    console.log(`📊 ${industry}.md generado`)
  }
}

main().catch(err => {
  console.error('❌ Error generando industries')
  console.error(err)
  process.exit(1)
})
