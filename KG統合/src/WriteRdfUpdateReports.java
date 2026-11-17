import java.io.IOException;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVPrinter;
import org.apache.jena.graph.Node;
import org.apache.jena.graph.NodeFactory;
import org.apache.jena.rdf.model.Model;
import org.apache.jena.rdf.model.ModelFactory;
import org.apache.jena.rdf.model.RDFNode;
import org.apache.jena.rdf.model.Resource;
import org.apache.jena.riot.Lang;
import org.apache.jena.riot.RDFDataMgr;
import org.apache.jena.sparql.core.DatasetGraph;
import org.apache.jena.sparql.core.DatasetGraphFactory;
import org.apache.jena.sparql.core.Quad;

/** 一括処理結果から、クラス別・資料種別別の件数TSVを作成します。 */
public final class WriteRdfUpdateReports {
    private static final String CLASS_NS = "https://kozaki-lab.jp/REFV-KG/class/";
    private static final String KG_NS = "https://kozaki-lab.jp/REFV-KG/data/";
    private static final String RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

    private static final Path TARGET_JSON = Paths.get(
            "input/target-classes/class-update-20261117-094934-210.json");
    private static final Path STAKEHOLDER_JSON = Paths.get(
            "input/stakeholders/class-update-20261117-104033-219.json");
    private static final Path TARGET_NQUADS = Paths.get(
            "output/classes/REV-KG-DEV_kg-data_2026-08-13_13-18-16_with-hierarchy.nq");
    private static final Path STAKEHOLDER_NQUADS = Paths.get("input/integration/stakeholders-with-top.nq");
    private static final Path DOCUMENT_TURTLE = Paths.get("input/integration/documents.ttl");
    private static final Path REPORT_DIRECTORY = Paths.get("output/reports");

    private static final List<DocumentType> DOCUMENT_TYPES = List.of(
            new DocumentType("CouncilMinutes", "議会会議録"),
            new DocumentType("ReviewBoardMaterial", "審査会資料"),
            new DocumentType("EnvironmentalAssessmentMaterial", "環境アセス資料"),
            new DocumentType("AdministrativeMaterial", "行政資料"),
            new DocumentType("BusinessMaterial", "事業者資料"),
            new DocumentType("CitizenGroupMaterial", "市民・住民団体資料"),
            new DocumentType("NewsReport", "報道"),
            new DocumentType("WebArticle", "Web記事"),
            new DocumentType("Publication", "広報・刊行物"),
            new DocumentType("Other", "その他"));

    private static final CSVFormat TSV = CSVFormat.TDF.builder().get();

    private WriteRdfUpdateReports() {}

    public static void main(String[] args) throws IOException {
        if (args.length != 0) throw new IllegalArgumentException("使い方: java WriteRdfUpdateReports（引数なし）");
        Files.createDirectories(REPORT_DIRECTORY);

        Map<String, Long> targetCounts = countTypes(TARGET_NQUADS, readTargetClassIris(TARGET_JSON));
        Map<String, Long> stakeholderCounts = countTypes(STAKEHOLDER_NQUADS, readStakeholderClassIris(STAKEHOLDER_JSON));
        Map<String, Long> documentCounts = countDocumentTypes(DOCUMENT_TURTLE);

        writeClassReport(REPORT_DIRECTORY.resolve("target-classes.tsv"), "class_iri", targetCounts);
        writeClassReport(REPORT_DIRECTORY.resolve("stakeholders.tsv"), "class_iri", stakeholderCounts);
        writeDocumentTypeReport(REPORT_DIRECTORY.resolve("document-types.tsv"), documentCounts);

        System.out.println("対象クラス一覧・件数: " + REPORT_DIRECTORY.resolve("target-classes.tsv").toAbsolutePath());
        System.out.println("ステークホルダークラス一覧・件数: " + REPORT_DIRECTORY.resolve("stakeholders.tsv").toAbsolutePath());
        System.out.println("資料種別一覧・件数: " + REPORT_DIRECTORY.resolve("document-types.tsv").toAbsolutePath());
    }

    private static Set<String> readTargetClassIris(Path jsonPath) throws IOException {
        JsonObject root = readJson(jsonPath);
        JsonArray relations = root.getAsJsonArray("relations");
        if (relations == null) throw new IOException("対象クラスJSONにrelationsがありません: " + jsonPath);
        Set<String> classes = new TreeSet<>();
        for (JsonElement element : relations) {
            JsonObject relation = element.getAsJsonObject();
            classes.add(requiredString(relation, "child", jsonPath));
            classes.add(requiredString(relation, "parent", jsonPath));
        }
        if (classes.isEmpty()) throw new IOException("対象クラスJSONにクラスがありません: " + jsonPath);
        return classes;
    }

    private static Set<String> readStakeholderClassIris(Path jsonPath) throws IOException {
        JsonObject root = readJson(jsonPath);
        JsonArray classesArray = root.getAsJsonArray("classes");
        if (classesArray == null) throw new IOException("ステークホルダーJSONにclassesがありません: " + jsonPath);
        Set<String> classes = new TreeSet<>();
        for (JsonElement element : classesArray) {
            JsonObject entry = element.getAsJsonObject();
            String id = requiredString(entry, "id", jsonPath);
            String type = entry.has("type") ? entry.get("type").getAsString() : "";
            if ("top".equals(type)) {
                classes.add(toStakeholderTopIri(id, jsonPath));
            } else if (id.startsWith(CLASS_NS + "st_")) {
                classes.add(id);
            }
        }
        if (classes.isEmpty()) throw new IOException("ステークホルダーJSONにクラスがありません: " + jsonPath);
        return classes;
    }

    private static String toStakeholderTopIri(String id, Path jsonPath) throws IOException {
        if (id.equals("t_0")) return CLASS_NS + "st_t_0";
        if (id.matches("new-t_\\d+")) return CLASS_NS + "st_t_" + id.substring("new-t_".length());
        if (id.matches("t_\\d+")) return CLASS_NS + "st_t_" + id.substring(2);
        if (id.startsWith(CLASS_NS + "st_t_")) return id;
        throw new IOException("上位クラスIDの形式が不正です: " + jsonPath + " / " + id);
    }

    private static Map<String, Long> countTypes(Path nquadsPath, Set<String> classes) throws IOException {
        if (!Files.isRegularFile(nquadsPath)) throw new IOException("集計対象N-Quadsがありません: " + nquadsPath);
        Map<String, Set<String>> subjectsByClass = new LinkedHashMap<>();
        for (String classIri : classes) subjectsByClass.put(classIri, new TreeSet<>());
        Node rdfType = NodeFactory.createURI(RDF_TYPE);
        DatasetGraph dataset = DatasetGraphFactory.createTxnMem();
        try {
            RDFDataMgr.read(dataset, nquadsPath.toUri().toString(), Lang.NQUADS);
            var quads = dataset.find(Node.ANY, Node.ANY, rdfType, Node.ANY);
            while (quads.hasNext()) {
                Quad quad = quads.next();
                Node object = quad.getObject();
                if (!object.isURI()) continue;
                Set<String> instances = subjectsByClass.get(object.getURI());
                if (instances != null) instances.add(quad.getSubject().toString());
            }
        } finally {
            dataset.close();
        }
        Map<String, Long> counts = new LinkedHashMap<>();
        subjectsByClass.forEach((iri, subjects) -> counts.put(iri, (long) subjects.size()));
        return counts;
    }

    private static Map<String, Long> countDocumentTypes(Path turtlePath) throws IOException {
        if (!Files.isRegularFile(turtlePath)) throw new IOException("集計対象Turtleがありません: " + turtlePath);
        Map<String, Set<String>> subjectsByType = new LinkedHashMap<>();
        for (DocumentType type : DOCUMENT_TYPES) subjectsByType.put(KG_NS + "documentType_" + type.code, new TreeSet<>());
        Model model = ModelFactory.createDefaultModel();
        try {
            RDFDataMgr.read(model, turtlePath.toUri().toString(), Lang.TURTLE);
            Resource anySubject = null;
            var property = model.createProperty(KG_NS.replace("/data/", "/prop/") + "documentType");
            var statements = model.listStatements(anySubject, property, (RDFNode) null);
            while (statements.hasNext()) {
                var statement = statements.next();
                RDFNode object = statement.getObject();
                if (!object.isURIResource()) continue;
                Set<String> subjects = subjectsByType.get(object.asResource().getURI());
                if (subjects != null) subjects.add(statement.getSubject().toString());
            }
        } finally {
            model.close();
        }
        Map<String, Long> counts = new LinkedHashMap<>();
        subjectsByType.forEach((iri, subjects) -> counts.put(iri, (long) subjects.size()));
        return counts;
    }

    private static void writeClassReport(Path path, String iriHeader, Map<String, Long> counts) throws IOException {
        writeTsv(path, new String[] { iriHeader, "instance_count" }, counts.entrySet().stream()
                .map(entry -> new String[] { entry.getKey(), entry.getValue().toString() }).toList());
    }

    private static void writeDocumentTypeReport(Path path, Map<String, Long> counts) throws IOException {
        List<String[]> rows = new ArrayList<>();
        for (DocumentType type : DOCUMENT_TYPES) {
            String iri = KG_NS + "documentType_" + type.code;
            rows.add(new String[] { iri, type.label, counts.getOrDefault(iri, 0L).toString() });
        }
        writeTsv(path, new String[] { "document_type_iri", "資料種別", "document_count" }, rows);
    }

    private static void writeTsv(Path path, String[] headers, List<String[]> rows) throws IOException {
        Path temporary = path.resolveSibling(path.getFileName() + ".tmp");
        try {
            try (Writer writer = Files.newBufferedWriter(temporary, StandardCharsets.UTF_8);
                    CSVPrinter printer = new CSVPrinter(writer,
                            TSV.builder().setHeader(headers).build())) {
                for (String[] row : rows) printer.printRecord((Object[]) row);
            }
            try {
                Files.move(temporary, path, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } catch (java.nio.file.AtomicMoveNotSupportedException e) {
                Files.move(temporary, path, StandardCopyOption.REPLACE_EXISTING);
            }
        } finally {
            Files.deleteIfExists(temporary);
        }
    }

    private static JsonObject readJson(Path path) throws IOException {
        if (!Files.isRegularFile(path)) throw new IOException("集計用JSONがありません: " + path);
        try (var reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
            return JsonParser.parseReader(reader).getAsJsonObject();
        }
    }

    private static String requiredString(JsonObject object, String field, Path path) throws IOException {
        if (!object.has(field) || object.get(field).isJsonNull()) {
            throw new IOException("JSONの必須項目がありません: " + path + " / " + field);
        }
        String value = object.get(field).getAsString().trim();
        if (value.isEmpty()) throw new IOException("JSONの必須項目が空です: " + path + " / " + field);
        return value;
    }

    private record DocumentType(String code, String label) {}
}
