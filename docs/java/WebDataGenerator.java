import java.io.IOException;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

/** 統合JSONを、Webページが読み込むapp.jsへ変換します。 */
public final class WebDataGenerator {
    private static final Path INPUT_DIRECTORY = Paths.get("data/integrated-data");
    private static final Path OUTPUT_FILE = Paths.get("app.js");
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

    private WebDataGenerator() {}

    public static void main(String[] args) throws IOException {
        JsonObject appData = new JsonObject();
        appData.add("classData", readJson("class-data.json"));
        appData.add("instanceClassData", readJson("instance-class-data.json"));
        appData.add("middleClassList", readJson("middle-class-list.json"));
        appData.add("topClassList", readJson("top-class-list.json"));

        Path temporaryOutput = OUTPUT_FILE.resolveSibling(OUTPUT_FILE.getFileName() + ".tmp");
        try (Writer writer = Files.newBufferedWriter(temporaryOutput, StandardCharsets.UTF_8)) {
            writer.write("window.appData = ");
            GSON.toJson(appData, writer);
            writer.write(";\n");
        }
        try {
            Files.move(temporaryOutput, OUTPUT_FILE, StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING);
        } catch (java.nio.file.AtomicMoveNotSupportedException e) {
            Files.move(temporaryOutput, OUTPUT_FILE, StandardCopyOption.REPLACE_EXISTING);
        }
        System.out.println("Web用app.jsを生成しました: " + OUTPUT_FILE);
    }

    private static JsonElement readJson(String fileName) throws IOException {
        Path input = INPUT_DIRECTORY.resolve(fileName);
        if (!Files.isRegularFile(input)) {
            throw new IOException("統合JSONが見つかりません: " + input);
        }
        try (var reader = Files.newBufferedReader(input, StandardCharsets.UTF_8)) {
            return JsonParser.parseReader(reader);
        }
    }
}
