import java.io.IOException;
import java.io.OutputStream;
import java.io.PushbackReader;
import java.io.Reader;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVParser;
import org.apache.commons.csv.CSVRecord;
import org.apache.jena.rdf.model.Model;
import org.apache.jena.rdf.model.ModelFactory;
import org.apache.jena.rdf.model.Property;
import org.apache.jena.rdf.model.Resource;
import org.apache.jena.riot.Lang;
import org.apache.jena.riot.RDFDataMgr;
import org.apache.jena.vocabulary.RDF;
import org.apache.jena.vocabulary.RDFS;

/** 分類済み一覧と元フォルダー一覧から、仕様に沿った文書Turtleを生成します。 */
public final class ConvertClassifiedDocumentsToTurtle {
    private static final Path DEFAULT_CLASSIFIED_TSV = Paths.get("input/integration/documents-classified.tsv");
    private static final Path DEFAULT_FILE_LIST_DIRECTORY = Paths.get("input/document-list");
    private static final Path DEFAULT_OUTPUT_TTL = Paths.get("input/integration/documents.ttl");
    private static final String PROP_NS = "https://kozaki-lab.jp/REFV-KG/prop/";
    private static final String CLS_NS = "https://kozaki-lab.jp/REFV-KG/class/";
    private static final String KG_NS = "https://kozaki-lab.jp/REFV-KG/data/";
    private static final Pattern NUMBERED_TRIG = Pattern.compile("(\\d{5})\\.trig$", Pattern.CASE_INSENSITIVE);
    private static final Map<String, String> PREFECTURES = Map.of(
            "山形", "Yamagata", "秋田", "Akita", "島根", "Shimane", "北海道", "Hokkaido");
    private static final Map<String, String> DOCUMENT_TYPES = Map.ofEntries(
            Map.entry("議会会議録", "CouncilMinutes"),
            Map.entry("審査会資料", "ReviewBoardMaterial"),
            Map.entry("環境アセス資料", "EnvironmentalAssessmentMaterial"),
            Map.entry("行政資料", "AdministrativeMaterial"),
            Map.entry("事業者資料", "BusinessMaterial"),
            Map.entry("市民・住民団体資料", "CitizenGroupMaterial"),
            Map.entry("報道", "NewsReport"),
            Map.entry("Web記事", "WebArticle"),
            Map.entry("広報・刊行物", "Publication"),
            Map.entry("その他", "Other"));

    private static final Resource DOCUMENT = resource(CLS_NS + "Document");
    private static final Property PREFECTURE_PROPERTY = property(PROP_NS + "prefecture");
    private static final Property DOCUMENT_TYPE_PROPERTY = property(PROP_NS + "documentType");
    private static final Property INPUT_FILE_PROPERTY = property(PROP_NS + "inputFileName");
    private static final Property SOURCE_FOLDER_PROPERTY = property(PROP_NS + "sourceFolderPath");

    private static final CSVFormat TSV = CSVFormat.TDF.builder()
            .setHeader().setSkipHeaderRecord(true).setIgnoreEmptyLines(true).get();

    private ConvertClassifiedDocumentsToTurtle() {}

    public static void main(String[] args) throws IOException {
        if (args.length > 3) {
            throw new IllegalArgumentException("使い方: java ConvertClassifiedDocumentsToTurtle "
                    + "[分類済みTSV] [*-files.tsvフォルダー] [出力TTL]");
        }
        Path classifiedTsv = args.length > 0 ? Paths.get(args[0]) : DEFAULT_CLASSIFIED_TSV;
        Path fileListDirectory = args.length > 1 ? Paths.get(args[1]) : DEFAULT_FILE_LIST_DIRECTORY;
        Path outputTtl = args.length > 2 ? Paths.get(args[2]) : DEFAULT_OUTPUT_TTL;
        if (!Files.isRegularFile(classifiedTsv)) throw new IOException("分類済みTSVがありません: " + classifiedTsv);
        if (!Files.isDirectory(fileListDirectory)) throw new IOException("*-files.tsvフォルダーがありません: " + fileListDirectory);

        Map<String, List<FolderEntry>> foldersByName = readFolderLists(fileListDirectory);
        Model model = createModel();
        Set<String> documentIris = new HashSet<>();
        int count = 0;
        try (var reader = readerWithoutBom(classifiedTsv);
                CSVParser parser = CSVParser.parse(reader, TSV)) {
            requireHeaders(classifiedTsv, parser,
                    "source_tsv", "graph", "documentIRI", "input_file", "output_file", "prefecture", "資料種別");
            for (CSVRecord row : parser) {
                String sourceTsv = required(row, "source_tsv", classifiedTsv);
                String graph = required(row, "graph", classifiedTsv);
                String documentIri = required(row, "documentIRI", classifiedTsv);
                String inputFile = required(row, "input_file", classifiedTsv);
                String outputFile = required(row, "output_file", classifiedTsv);
                String prefectureName = required(row, "prefecture", classifiedTsv);
                String documentTypeName = required(row, "資料種別", classifiedTsv);

                String prefectureCode = PREFECTURES.get(prefectureName);
                if (prefectureCode == null) throw rowError(classifiedTsv, row, "未知の都道府県: " + prefectureName);
                String documentTypeCode = DOCUMENT_TYPES.get(documentTypeName);
                if (documentTypeCode == null) throw rowError(classifiedTsv, row, "未知の資料種別: " + documentTypeName);
                validateDocumentIri(sourceTsv, graph, documentIri, outputFile, classifiedTsv, row);
                if (!documentIris.add(documentIri)) throw rowError(classifiedTsv, row, "文書IRIが重複しています: " + documentIri);

                String sourceFolder = findSourceFolder(sourceTsv, inputFile, prefectureName,
                        foldersByName, classifiedTsv, row);
                addDocument(model, documentIri, inputFile, prefectureCode, prefectureName,
                        documentTypeCode, documentTypeName, sourceFolder);
                count++;
            }
        }
        if (count == 0) throw new IOException("分類済みTSVにデータ行がありません: " + classifiedTsv);
        writeTurtle(outputTtl, model);
        System.out.println("最終Turtle: " + outputTtl.toAbsolutePath());
        System.out.println("文書件数: " + count);
        System.out.println("資料種別・保存元フォルダーを含めて出力しました。");
    }

    private static Map<String, List<FolderEntry>> readFolderLists(Path directory) throws IOException {
        Map<String, List<FolderEntry>> byName = new HashMap<>();
        try (var paths = Files.list(directory)) {
            for (Path listPath : paths.filter(Files::isRegularFile)
                    .filter(path -> path.getFileName().toString().toLowerCase(Locale.ROOT).endsWith("-files.tsv"))
                    .sorted().toList()) {
                try (var reader = readerWithoutBom(listPath);
                        CSVParser parser = CSVParser.parse(reader, TSV)) {
                    String fileHeader = findHeader(parser, "ファイル名", "file_name", "filename", "input_file");
                    String folderHeader = findHeader(parser, "保存されていたフォルダ名", "sourceFolderPath", "source_folder_path");
                    if (fileHeader == null || folderHeader == null) {
                        throw new IOException("*-files.tsvにファイル名・保存されていたフォルダ名の列がありません: " + listPath);
                    }
                    for (CSVRecord row : parser) {
                        String name = cell(row, fileHeader);
                        String folder = cell(row, folderHeader);
                        if (name.isEmpty() || folder.isEmpty()) {
                            throw new IOException("*-files.tsvの必須値が空です: " + listPath + " 行 " + row.getRecordNumber());
                        }
                        byName.computeIfAbsent(name, ignored -> new ArrayList<>())
                                .add(new FolderEntry(listPath.getFileName().toString(), folder));
                    }
                }
            }
        }
        if (byName.isEmpty()) throw new IOException("対応する*-files.tsvがありません: " + directory);
        return byName;
    }

    private static String findSourceFolder(String sourceTsv, String fileName, String prefecture,
            Map<String, List<FolderEntry>> foldersByName, Path classifiedTsv, CSVRecord row) throws IOException {
        List<FolderEntry> candidates = foldersByName.get(fileName);
        if (candidates == null || candidates.isEmpty()) {
            candidates = foldersByName.get(normalizeFileNameForMatch(fileName));
        }
        if (candidates == null || candidates.isEmpty()) {
            throw rowError(classifiedTsv, row, "保存元フォルダーを照合できません。*-files.tsvにファイルがありません: " + fileName);
        }
        String expectedKey = sourceKey(sourceTsv);
        List<FolderEntry> matching = candidates.stream()
                .filter(entry -> fileListKey(entry.listName).equalsIgnoreCase(expectedKey)).toList();
        if (matching.isEmpty() && expectedKey.equals("shimane")) {
            matching = candidates.stream()
                    .filter(entry -> fileListKey(entry.listName).equalsIgnoreCase("akita")).toList();
        }
        if (matching.isEmpty() && candidates.size() == 1) matching = candidates;
        Set<String> distinctFolders = new HashSet<>();
        for (FolderEntry entry : matching) distinctFolders.add(entry.folder.trim());
        if (distinctFolders.size() != 1) {
            throw rowError(classifiedTsv, row,
                    "保存元フォルダーの候補が一意ではありません: " + fileName + " / " + candidates);
        }
        return normalizeFolderPath(prefecture, distinctFolders.iterator().next(), classifiedTsv, row);
    }

    private static String sourceKey(String sourceTsv) {
        String name = Paths.get(sourceTsv).getFileName().toString().toLowerCase(Locale.ROOT);
        name = name.replaceFirst("^output_", "").replaceFirst("_relation\\.tsv$", "");
        return name;
    }

    private static String fileListKey(String fileListName) {
        return Paths.get(fileListName).getFileName().toString().toLowerCase(Locale.ROOT)
                .replaceFirst("-files\\.tsv$", "");
    }

    private static String normalizeFileNameForMatch(String fileName) {
        // One source list used the literal text "$201F" where another recorded U+201F (‟).
        return fileName.replace("$201F", "\u201F");
    }

    private static String normalizeFolderPath(String prefecture, String rawPath, Path path, CSVRecord row)
            throws IOException {
        String normalized = rawPath.trim().replace('\\', '/').replaceAll("/\\./", "/");
        while (normalized.startsWith("./")) normalized = normalized.substring(2);
        normalized = normalized.replaceAll("/+$", "").replaceAll("/{2,}", "/");
        if (normalized.isEmpty() || normalized.equals(".")) return prefecture;
        if (normalized.startsWith("/") || normalized.matches("^[A-Za-z]:.*") || normalized.equals("..")
                || normalized.startsWith("../") || normalized.contains("/../")) {
            throw rowError(path, row, "保存フォルダー名は相対パスである必要があります: " + rawPath);
        }
        if (normalized.equals(prefecture) || normalized.startsWith(prefecture + "/")) return normalized;
        return prefecture + "/" + normalized;
    }

    private static void validateDocumentIri(String sourceTsv, String graph, String documentIri,
            String outputFile, Path path, CSVRecord row) throws IOException {
        try {
            if (!URI.create(documentIri).isAbsolute()) throw new IllegalArgumentException();
        } catch (IllegalArgumentException e) {
            throw rowError(path, row, "documentIRIが有効なIRIではありません: " + documentIri);
        }
        String key = sourceKey(sourceTsv);
        if (key.equals("yamagata") || key.equals("yamagataweb")) {
            Matcher matcher = NUMBERED_TRIG.matcher(outputFile);
            if (!matcher.find()) throw rowError(path, row, "山形のoutput_fileから5桁番号を取得できません: " + outputFile);
            String branch = key.equals("yamagataweb") ? "YamagataWeb" : "Yamagata";
            String expected = "https://kozaki-lab.jp/REFV-KG/docs/" + branch + "/" + matcher.group(1);
            if (!documentIri.equals(expected)) throw rowError(path, row, "山形系documentIRIが規則と一致しません。期待値: " + expected);
        } else if (!documentIri.equals(graph)) {
            throw rowError(path, row, "山形系以外のdocumentIRIはgraph列と一致する必要があります: " + graph);
        }
    }

    private static Model createModel() {
        Model model = ModelFactory.createDefaultModel();
        model.setNsPrefix("rdf", RDF.getURI());
        model.setNsPrefix("rdfs", RDFS.getURI());
        model.setNsPrefix("cls", CLS_NS);
        model.setNsPrefix("prop", PROP_NS);
        model.setNsPrefix("kg", KG_NS);
        Resource documentType = resource(CLS_NS + "DocumentType");
        Resource prefectureType = resource(CLS_NS + "Prefecture");
        model.add(DOCUMENT, RDF.type, RDFS.Class).add(DOCUMENT, RDFS.label, "文書", "ja");
        model.add(documentType, RDF.type, RDFS.Class).add(documentType, RDFS.label, "資料種別", "ja");
        model.add(prefectureType, RDF.type, RDFS.Class).add(prefectureType, RDFS.label, "都道府県", "ja");
        addProperty(model, PREFECTURE_PROPERTY, "都道府県", DOCUMENT, prefectureType);
        addProperty(model, DOCUMENT_TYPE_PROPERTY, "資料種別", DOCUMENT, documentType);
        addProperty(model, INPUT_FILE_PROPERTY, "入力ファイル名", DOCUMENT, RDFS.Literal);
        addProperty(model, SOURCE_FOLDER_PROPERTY, "保存されていたフォルダ名", DOCUMENT, RDFS.Literal);
        PREFECTURES.forEach((label, code) -> model.add(resource(KG_NS + "prefecture_" + code), RDF.type, prefectureType)
                .add(resource(KG_NS + "prefecture_" + code), RDFS.label, label, "ja"));
        DOCUMENT_TYPES.forEach((label, code) -> model.add(resource(KG_NS + "documentType_" + code), RDF.type, documentType)
                .add(resource(KG_NS + "documentType_" + code), RDFS.label, label, "ja"));
        return model;
    }

    private static void addProperty(Model model, Property property, String label, Resource domain, Resource range) {
        model.add(property, RDF.type, RDF.Property).add(property, RDFS.label, label, "ja")
                .add(property, RDFS.domain, domain).add(property, RDFS.range, range);
    }

    private static void addDocument(Model model, String iri, String inputFile, String prefectureCode,
            String prefectureName, String documentTypeCode, String documentTypeName, String sourceFolder) {
        Resource document = resource(iri);
        model.add(document, RDF.type, DOCUMENT)
                .add(document, RDFS.label, inputFile)
                .add(document, PREFECTURE_PROPERTY, resource(KG_NS + "prefecture_" + prefectureCode))
                .add(document, DOCUMENT_TYPE_PROPERTY, resource(KG_NS + "documentType_" + documentTypeCode))
                .add(document, INPUT_FILE_PROPERTY, inputFile)
                .add(document, SOURCE_FOLDER_PROPERTY, sourceFolder);
    }

    private static String findHeader(CSVParser parser, String... candidates) {
        for (String candidate : candidates) {
            for (String header : parser.getHeaderMap().keySet()) {
                if (header.trim().replace("\uFEFF", "").equalsIgnoreCase(candidate)) return header;
            }
        }
        return null;
    }

    private static void requireHeaders(Path path, CSVParser parser, String... headers) throws IOException {
        for (String header : headers) {
            if (!parser.getHeaderMap().containsKey(header)) throw new IOException("必要な列がありません: " + path + " / " + header);
        }
    }

    private static String required(CSVRecord row, String header, Path path) throws IOException {
        String value = cell(row, header);
        if (value.isEmpty()) throw rowError(path, row, "必須値が空です: " + header);
        return value;
    }

    private static String cell(CSVRecord row, String header) {
        return row.get(header).trim();
    }

    private static Reader readerWithoutBom(Path path) throws IOException {
        PushbackReader reader = new PushbackReader(Files.newBufferedReader(path, StandardCharsets.UTF_8), 1);
        int first = reader.read();
        if (first != -1 && first != '\uFEFF') reader.unread(first);
        return reader;
    }

    private static IOException rowError(Path path, CSVRecord row, String message) {
        return new IOException(path + " 行 " + row.getRecordNumber() + ": " + message);
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
                Files.move(temporary, absolute, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
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

    private record FolderEntry(String listName, String folder) {}
}
