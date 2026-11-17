import java.io.IOException;
import java.io.OutputStream;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVParser;
import org.apache.commons.csv.CSVPrinter;
import org.apache.commons.csv.CSVRecord;
import org.apache.jena.rdf.model.Model;
import org.apache.jena.rdf.model.ModelFactory;
import org.apache.jena.rdf.model.Property;
import org.apache.jena.rdf.model.Resource;
import org.apache.jena.riot.Lang;
import org.apache.jena.riot.RDFDataMgr;
import org.apache.jena.vocabulary.RDF;
import org.apache.jena.vocabulary.RDFS;

/** 関係TSVから、確定できる文書情報だけをTurtleへ変換します。 */
public final class ConvertDocumentRelationsToTurtle {
    private static final Path DEFAULT_INPUT_DIRECTORY = Paths.get("input/document-list");
    private static final Path DEFAULT_OUTPUT_TTL = Paths.get("input/integration/documents-basic.ttl");
    private static final Path DEFAULT_REVIEW_TSV = Paths.get("input/integration/documents-review.tsv");
    private static final Pattern NUMBERED_TRIG = Pattern.compile("(\\d{5})\\.trig$", Pattern.CASE_INSENSITIVE);

    private static final String PROP_NS = "https://kozaki-lab.jp/REFV-KG/prop/";
    private static final String CLS_NS = "https://kozaki-lab.jp/REFV-KG/class/";
    private static final String KG_NS = "https://kozaki-lab.jp/REFV-KG/data/";
    private static final Resource DOCUMENT = resource(CLS_NS + "Document");
    private static final Resource PREFECTURE = resource(CLS_NS + "Prefecture");
    private static final Resource DOCUMENT_TYPE = resource(CLS_NS + "DocumentType");
    private static final Property PREFECTURE_PROPERTY = property(PROP_NS + "prefecture");
    private static final Property DOCUMENT_TYPE_PROPERTY = property(PROP_NS + "documentType");
    private static final Property INPUT_FILE_PROPERTY = property(PROP_NS + "inputFileName");
    private static final Property SOURCE_FOLDER_PROPERTY = property(PROP_NS + "sourceFolderPath");
    private static final CSVFormat INPUT_TSV = CSVFormat.TDF.builder()
            .setHeader().setSkipHeaderRecord(true).setIgnoreEmptyLines(true).get();
    private static final CSVFormat OUTPUT_TSV = CSVFormat.TDF.builder()
            .setHeader("source_tsv", "graph", "documentIRI", "input_file", "output_file",
                    "prefecture", "資料種別", "判定根拠", "確信度", "保存されていたフォルダ名")
            .get();

    private ConvertDocumentRelationsToTurtle() {}

    public static void main(String[] args) throws IOException {
        if (args.length > 3) {
            throw new IllegalArgumentException("使い方: java ConvertDocumentRelationsToTurtle "
                    + "[入力フォルダー] [出力TTL] [レビューTSV]");
        }
        Path inputDirectory = args.length > 0 ? Paths.get(args[0]) : DEFAULT_INPUT_DIRECTORY;
        Path outputTtl = args.length > 1 ? Paths.get(args[1]) : DEFAULT_OUTPUT_TTL;
        Path reviewTsv = args.length > 2 ? Paths.get(args[2]) : DEFAULT_REVIEW_TSV;
        if (!Files.isDirectory(inputDirectory)) throw new IOException("入力フォルダーがありません: " + inputDirectory);

        Model model = ModelFactory.createDefaultModel();
        model.setNsPrefix("rdf", RDF.getURI());
        model.setNsPrefix("rdfs", RDFS.getURI());
        model.setNsPrefix("cls", CLS_NS);
        model.setNsPrefix("prop", PROP_NS);
        model.setNsPrefix("kg", KG_NS);
        addVocabulary(model);

        Set<String> subjectIris = new HashSet<>();
        int rowCount = 0;
        Files.createDirectories(reviewTsv.toAbsolutePath().getParent());
        try (Writer reviewWriter = Files.newBufferedWriter(reviewTsv, StandardCharsets.UTF_8);
                CSVPrinter review = new CSVPrinter(reviewWriter, OUTPUT_TSV);
                var files = Files.list(inputDirectory)) {
            for (Path tsv : files.filter(Files::isRegularFile)
                    .filter(path -> path.getFileName().toString().endsWith("_relation.tsv"))
                    .sorted().toList()) {
                Prefecture prefecture = prefectureFor(tsv.getFileName().toString());
                try (var reader = Files.newBufferedReader(tsv, StandardCharsets.UTF_8);
                        CSVParser parser = CSVParser.parse(reader, INPUT_TSV)) {
                    requireHeaders(tsv, parser);
                    for (CSVRecord record : parser) {
                        String inputFile = required(record, "input_file", tsv);
                        String graph = required(record, "graph", tsv);
                        String outputFile = required(record, "output_file", tsv);
                        String documentIri = documentIri(tsv.getFileName().toString(), graph, outputFile);
                        if (!subjectIris.add(documentIri)) {
                            throw new IOException("文書IRIが重複しています: " + documentIri);
                        }
                        addDocument(model, documentIri, inputFile, prefecture);
                        review.printRecord(tsv.getFileName(), graph, documentIri, inputFile,
                                outputFile, prefecture.japaneseName, "", "", "", "");
                        rowCount++;
                    }
                }
            }
        }
        if (rowCount == 0) throw new IOException("*_relation.tsv がありません: " + inputDirectory);
        writeTurtle(outputTtl, model);
        System.out.println("部分Turtle: " + outputTtl.toAbsolutePath());
        System.out.println("分類レビュー用TSV: " + reviewTsv.toAbsolutePath());
        System.out.println("文書件数: " + rowCount);
        System.out.println("資料種別・保存フォルダ名は未設定のままです。");
    }

    private static void addVocabulary(Model model) {
        model.add(DOCUMENT, RDF.type, RDFS.Class).add(DOCUMENT, RDFS.label, "文書", "ja");
        model.add(PREFECTURE, RDF.type, RDFS.Class).add(PREFECTURE, RDFS.label, "都道府県", "ja");
        model.add(DOCUMENT_TYPE, RDF.type, RDFS.Class).add(DOCUMENT_TYPE, RDFS.label, "資料種別", "ja");
        addPropertyDefinition(model, PREFECTURE_PROPERTY, "都道府県", DOCUMENT, PREFECTURE);
        addPropertyDefinition(model, DOCUMENT_TYPE_PROPERTY, "資料種別", DOCUMENT, DOCUMENT_TYPE);
        addPropertyDefinition(model, INPUT_FILE_PROPERTY, "入力ファイル名", DOCUMENT, RDFS.Literal);
        addPropertyDefinition(model, SOURCE_FOLDER_PROPERTY, "保存されていたフォルダ名", DOCUMENT, RDFS.Literal);
        addPrefecture(model, "Yamagata", "山形");
        addPrefecture(model, "Akita", "秋田");
        addPrefecture(model, "Shimane", "島根");
        addPrefecture(model, "Hokkaido", "北海道");
        addDocumentType(model, "CouncilMinutes", "議会会議録");
        addDocumentType(model, "ReviewBoardMaterial", "審査会資料");
        addDocumentType(model, "EnvironmentalAssessmentMaterial", "環境アセス資料");
        addDocumentType(model, "AdministrativeMaterial", "行政資料");
        addDocumentType(model, "BusinessMaterial", "事業者資料");
        addDocumentType(model, "CitizenGroupMaterial", "市民・住民団体資料");
        addDocumentType(model, "NewsReport", "報道");
        addDocumentType(model, "WebArticle", "Web記事");
        addDocumentType(model, "Publication", "広報・刊行物");
        addDocumentType(model, "Other", "その他");
    }

    private static void addPropertyDefinition(Model model, Property property, String label,
            Resource domain, Resource range) {
        model.add(property, RDF.type, RDF.Property).add(property, RDFS.label, label, "ja")
                .add(property, RDFS.domain, domain).add(property, RDFS.range, range);
    }

    private static void addPrefecture(Model model, String id, String label) {
        Resource resource = resource(KG_NS + "prefecture_" + id);
        model.add(resource, RDF.type, PREFECTURE).add(resource, RDFS.label, label, "ja");
    }

    private static void addDocumentType(Model model, String id, String label) {
        Resource resource = resource(KG_NS + "documentType_" + id);
        model.add(resource, RDF.type, DOCUMENT_TYPE).add(resource, RDFS.label, label, "ja");
    }

    private static void addDocument(Model model, String iri, String inputFile, Prefecture prefecture) {
        Resource document = resource(iri);
        model.add(document, RDF.type, DOCUMENT)
                .add(document, RDFS.label, inputFile)
                .add(document, INPUT_FILE_PROPERTY, inputFile)
                .add(document, PREFECTURE_PROPERTY, resource(KG_NS + "prefecture_" + prefecture.code));
    }

    private static String documentIri(String relationFile, String graph, String outputFile) throws IOException {
        String lowerName = relationFile.toLowerCase(Locale.ROOT);
        if (lowerName.contains("yamagata")) {
            Matcher matcher = NUMBERED_TRIG.matcher(outputFile);
            if (!matcher.find()) throw new IOException("山形のoutput_fileから5桁番号を取得できません: " + outputFile);
            String branch = lowerName.contains("yamagataweb") ? "YamagataWeb" : "Yamagata";
            return "https://kozaki-lab.jp/REFV-KG/docs/" + branch + "/" + matcher.group(1);
        }
        try {
            java.net.URI uri = java.net.URI.create(graph);
            if (!uri.isAbsolute()) throw new IllegalArgumentException();
        } catch (IllegalArgumentException e) {
            throw new IOException("graphが有効なIRIではありません: " + graph, e);
        }
        return graph;
    }

    private static Prefecture prefectureFor(String fileName) throws IOException {
        String name = fileName.toLowerCase(Locale.ROOT);
        if (name.contains("yamagata")) return new Prefecture("Yamagata", "山形");
        if (name.contains("akita")) return new Prefecture("Akita", "秋田");
        if (name.contains("shimane")) return new Prefecture("Shimane", "島根");
        if (name.contains("hokkaido")) return new Prefecture("Hokkaido", "北海道");
        throw new IOException("TSV名から都道府県を判定できません: " + fileName);
    }

    private static void requireHeaders(Path tsv, CSVParser parser) throws IOException {
        for (String header : new String[] { "input_file", "graph", "output_file" }) {
            if (!parser.getHeaderMap().containsKey(header)) {
                throw new IOException("必要な列がありません: " + tsv + " / " + header);
            }
        }
    }

    private static String required(CSVRecord record, String header, Path path) throws IOException {
        String value = record.get(header).trim();
        if (value.isEmpty()) throw new IOException("必須値が空です: " + path + " 行 " + record.getRecordNumber() + " / " + header);
        return value;
    }

    private static void writeTurtle(Path output, Model model) throws IOException {
        Path absolute = output.toAbsolutePath();
        Files.createDirectories(absolute.getParent());
        Path temporary = absolute.resolveSibling(absolute.getFileName() + ".tmp");
        try {
            try (OutputStream stream = Files.newOutputStream(temporary)) {
                RDFDataMgr.write(stream, model, Lang.TURTLE);
            }
            try {
                Files.move(temporary, absolute, StandardCopyOption.ATOMIC_MOVE,
                        StandardCopyOption.REPLACE_EXISTING);
            } catch (java.nio.file.AtomicMoveNotSupportedException e) {
                Files.move(temporary, absolute, StandardCopyOption.REPLACE_EXISTING);
            }
        } finally {
            Files.deleteIfExists(temporary);
        }
    }

    private static Resource resource(String uri) {
        return ModelFactory.createDefaultModel().createResource(uri);
    }

    private static Property property(String uri) {
        return ModelFactory.createDefaultModel().createProperty(uri);
    }

    private record Prefecture(String code, String japaneseName) {}
}
