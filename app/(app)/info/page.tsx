import { PageTitle } from "@/components/analyze/file-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Contact, CodeLinks } from "./contact";

export const metadata = { title: "Info · SAR Analyzer" };

const STACK = [
  ["Python", "https://www.python.org/", "the sar parser and the APIs"],
  ["Polars", "https://pola.rs/", "the in-memory data of a sar file, statistics and filters"],
  ["FastAPI", "https://fastapi.tiangolo.com/", "sar-web-api, the data service of this frontend"],
  ["Next.js and React", "https://nextjs.org/", "this web frontend"],
  ["Apache ECharts", "https://echarts.apache.org/", "the diagrams"],
  ["SQLAlchemy, SQLite, Redis", "https://www.sqlalchemy.org/", "users, metric descriptions, caches"],
] as const;

// "Info" of the Streamlit app: about, FAQ, code.
export default function InfoPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <PageTitle title="Info" description="About the SAR Analyzer" />
      <Card>
        <CardHeader>
          <CardTitle>About</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed">
          <p>
            The SAR Analyzer was written because of the limitations of the existing graphical tools for exploring
            sysstat <code>sar</code> data. This web frontend uses the parser of the original Streamlit app unchanged.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            {STACK.map(([name, url, purpose]) => (
              <li key={name}>
                <a className="font-medium underline underline-offset-2" href={url} target="_blank" rel="noreferrer">
                  {name}
                </a>{" "}
                – {purpose}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>FAQ</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm leading-relaxed" data-testid="faq">
          <div>
            <h3 className="font-medium">I forgot my password</h3>
            <p className="text-muted-foreground">
              Please contact <Contact />.
            </p>
          </div>
          <div>
            <h3 className="font-medium">What can I do with the diagrams?</h3>
            <p className="text-muted-foreground">
              Zoom with the mouse wheel or the slider below a diagram, drag to move the visible range, click a
              legend entry to hide or show a metric. The buttons at the top right zoom into a selected area, undo
              the zoom, reset the diagram and save it as an image. Red dashed lines mark a restart of the system.
            </p>
          </div>
          <div>
            <h3 className="font-medium">Why does the first analysis of a file take time?</h3>
            <p className="text-muted-foreground">
              The first time a sar file is analysed it is parsed and stored in a compressed format (parquet), about
              1:20 of the text file. Every later view reads the parquet data, and the server keeps recently used
              files in memory, so switching between views and metrics is fast.
            </p>
          </div>
          <div>
            <h3 className="font-medium">Can this app be containerized?</h3>
            <p className="text-muted-foreground">Yes, please do it.</p>
          </div>
          <div>
            <h3 className="font-medium">Whom to contact in case of an error?</h3>
            <p className="text-muted-foreground">
              <Contact withChannel />.
            </p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Code</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <CodeLinks />
        </CardContent>
      </Card>
    </div>
  );
}
