import { AfterViewInit, Component, ElementRef, HostListener, OnInit, Renderer2, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
// import pdfjs
import * as pdfjsLib from 'pdfjs-dist';
import { DragScrollDirective } from '../directives/drag-scroll.directive';

// 핀치 줌 구현을 위한 라이브러리
import * as Hammer from 'hammerjs';

// tesseract.js OCR 테스트
import Tesseract from 'tesseract.js';
import { NaverOcrService } from '../apis/naver-ocr.service';

// fabric.js를 활용한 판서 기능 개발
import fabric_js from 'fabric';
import { DocService } from '../apis/doc.service';


@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, FormsModule, DragScrollDirective],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit, AfterViewInit {
  title = 'angular_pdf';

  @ViewChild('viewerContainer') container!: ElementRef;
  @ViewChild('pdfViewer') pdfViewer!: ElementRef;
  @ViewChild('fabricViewer') fabricViewer!: ElementRef;
  @ViewChild('page_num') pageNumEl!: ElementRef;
  @ViewChild('canvasContainer') canvasContainer!: ElementRef;

  @ViewChild('fabricGuard') fabricGuard!: ElementRef;

  pdfDoc: any = null; // pdf 정보
  pageNum: number = 1; // 현재 페이지
  totalPageNum: number = 0; // pdf 전체 페이지
  pageRendering: boolean = false;
  pageNumPending: any = null;
  scale = 100; // pdf 크기
  ctx: any; // 2d 캔버스

  CMAP_URL = '/assets/lib/pdf/cmaps/'
  CMAP_PACKED = true;
  page_count: number = 0;
  rotation: number = 0;

  fabricCanvas: any;

  firstWidth: number = 0;
  firstHeight: number = 0;

  isZooming: boolean = false;
  isRotating: boolean = false;

  // 페이지 드래그 할 수 있는 모드
  dragMode: boolean = true; // 처음엔 드래그만 할 수 있도록
  drawingMode: boolean = false; // 그림 그리는 모드는 일단 첫 화면에서는 비활성화

  // 
  addText: boolean = false;

  // 현재 문서에 대한 여러 정보들이 들어갈겁니다..
  docData: any = {};

  constructor(
    private naverOcrService: NaverOcrService,
    private docService: DocService,
    private renderer: Renderer2) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = './assets/lib/pdf/pdf.worker.js',
      this.docData = this.docService.getDocData();
  }

  ngOnInit(): void {
    // ctrl + wheel 테스트
    window.addEventListener('wheel', (passiveEvent: WheelEvent) => {
      if (passiveEvent.ctrlKey) {
        passiveEvent.preventDefault();
        if (passiveEvent.deltaY > 0) {
          this.zoomOut()
        } else {
          this.zoomIn()
        }
      }
    }, { passive: false })

  }

  ngAfterViewInit() {
    this.ctx = this.pdfViewer.nativeElement.getContext('2d');

    pdfjsLib.getDocument({ url: './assets/pdf/[회의자료]제10기 제3차 이사회 회의자료(23.12.20).pdf', cMapUrl: this.CMAP_URL, cMapPacked: this.CMAP_PACKED }).promise.then(pdfDoc_ => {
      this.pdfDoc = pdfDoc_;
      this.page_count = this.pdfDoc.numPages;
      this.rotation = this.docData[this.pageNum].degree;
      this.renderPage(this.pageNum)
    })

  }


  async renderPage(num: number, degree: number = 0) {
    this.pageRendering = true; // 페이지 렌더링을 시작합니다

    this.pdfDoc.getPage(num).then((page: any) => {
      let viewport = page.getViewport({
        scale: Math.ceil(this.scale) / 100, rotation: this.rotation
      });
      this.pdfViewer.nativeElement.height = viewport.height;
      this.pdfViewer.nativeElement.width = viewport.width;



      this.renderer.setStyle(this.canvasContainer.nativeElement, 'height', `${viewport.height}px`)
      this.renderer.setStyle(this.canvasContainer.nativeElement, 'width', `${viewport.width}px`)

      // 캔버스에 그리기 시작
      let renderContext = {
        canvasContext: this.ctx,
        viewport: viewport
      }
      let renderTask = page.render(renderContext);

      renderTask.promise.then(() => {
        this.pageRendering = false; // 페이지 렌더링을 끝냅니다.
        if (this.pageNumPending !== null) {
          // New page rendering is pending
          this.renderPage(this.pageNumPending);
          this.pageNumPending = null;
        }



        // fabric js 설정
        if (!this.fabricCanvas) {
          let firstViewport = page.getViewport({
            scale: 1
          });
          this.firstWidth = firstViewport.width;
          this.firstHeight = firstViewport.height;

          this.fabricViewer.nativeElement.height = viewport.height;
          this.fabricViewer.nativeElement.width = viewport.width;
          this.setFabric(viewport.width, viewport.height);
        } else if (this.isZooming) {
          this.resizeFabric(viewport.width, viewport.height)
        } else if (this.isRotating) {
          this.rotateFabric(viewport.width, viewport.height, degree)
        }
        else {

          this.fabricCanvas.setDimensions({ width: viewport.width, height: viewport.height });

          if (this.docData[this.pageNum])
            this.fabricCanvas.loadFromJSON({ objects: this.docData[this.pageNum].objects }, this.fabricCanvas.renderAll.bind(this.fabricCanvas))
          this.setCanvas();
          this.resizeFabric(this.fabricCanvas.getWidth(), this.fabricCanvas.getHeight())
        }
      })
    })

    // 페이지 카운터 업데이트
    this.pageNumEl.nativeElement.textContent = num.toString();
  }


  async queueRenderPage(num: number, degree: number = 0) {

    if (this.pageNum < 1) {
      return;
    }
    if (this.pageNum > this.pdfDoc.numPages) {
      return;
    }
    if (this.pageRendering) {
      this.pageNumPending = num;
    } else {

      // this.rotation = this.docData[this.pageNum].degree;
      await this.renderPage(num, degree);

    }
  }

  onGoPage(pageNum: number) {
    this.fabricCanvas.clear()
    this.pageNum = pageNum
    if (this.docData[this.pageNum])
      this.rotation = this.docData[this.pageNum].degree;
    else
      this.rotation = 0
    this.queueRenderPage(this.pageNum)
  }

  onPrevPage() {
    this.fabricCanvas.clear()
    this.pageNum--;
    if (this.docData[this.pageNum])
      this.rotation = this.docData[this.pageNum].degree;
    else
      this.rotation = 0
    this.queueRenderPage(this.pageNum)
  }

  onNextPage() {
    this.fabricCanvas.clear()
    if (this.pageNum > this.pdfDoc.numPages) {
      return;
    }

    this.pageNum++;
    if (this.docData[this.pageNum])
      this.rotation = this.docData[this.pageNum].degree;
    else
      this.rotation = 0
    this.queueRenderPage(this.pageNum);
  }

  //=======================================
  webViewerRotateCw() {
    this.isRotating = true;
    this.rotation += 90;
    if (this.rotation >= 360) this.rotation = 0;
    this.queueRenderPage(this.pageNum, +90)
  }

  webViewerRotateCcw() {
    this.isRotating = true;
    this.rotation -= 90;
    if (this.rotation <= -360) this.rotation = 0;
    this.queueRenderPage(this.pageNum, -90)
  }

  //======================================
  zoomIn() {
    this.isZooming = true;
    this.scale += 10;
    this.queueRenderPage(this.pageNum)
  }

  zoomOut() {
    this.isZooming = true;
    this.scale -= 10;
    this.queueRenderPage(this.pageNum)

  }


  fitWidth() {
    this.isZooming = true;
    const pageWidthScale = Math.ceil(((this.container.nativeElement.clientWidth - 4) / (this.pdfViewer.nativeElement.clientWidth)) * this.scale)
    this.scale = pageWidthScale;
    this.queueRenderPage(this.pageNum)
  }


  fitPage() {
    this.isZooming = true;
    const pageWidthScale = Math.ceil(((this.container.nativeElement.clientWidth - 4) / (this.pdfViewer.nativeElement.clientWidth)) * this.scale)
    const pageHeightScale = Math.ceil(((this.container.nativeElement.clientHeight) / (this.pdfViewer.nativeElement.clientHeight)) * this.scale)

    this.scale = Math.min(pageWidthScale, pageHeightScale);

    this.queueRenderPage(this.pageNum)
  }



  // 핀치줌 = 테스트는 안해봤음...
  addPinchZoom(): void {
    const mc = new Hammer.Manager(this.container.nativeElement);

    mc.add(new Hammer.Pinch());

    mc.on('pinchmove', (e: any) => {
      e.scale > 1 ? this.zoomIn() : this.zoomOut()
    })
  }



  // fabric js
  // 패브릭 초기 세팅
  async setFabric(width: number, height: number) {
    this.fabricCanvas = new fabric_js.fabric.Canvas('fabricCanvas');

    if (this.docData['1']) {
      this.fabricCanvas.loadFromJSON({ objects: this.docData['1'].objects }, this.fabricCanvas.renderAll.bind(this.fabricCanvas))
    }


    //================================================================
    this.fabricCanvas.on('mouse:down', (e: any) => {
      if (this.addText) {
        const text = new fabric_js.fabric.Textbox('두 번 클릭하여 내용을 입력해 주세요', {
          fontSize: 15,
          cursorColor: 'blue',
          width: 130,
          left: e.absolutePointer.x,
          top: e.absolutePointer.y
        });
        this.fabricCanvas.add(text);
        this.fabricCanvas.renderAll()
        this.addText = false;
      }
    })
    //==================================================================
    this.setCanvas();
    this.resizeFabric(width, height)
  }

  // 패브릭 크기 수정
  //https://hackernoon.com/getting-started-with-fabricjs-in-angular-13-creating-and-editing-canvas
  async resizeFabric(width: number, height: number) {
    // 비율 계산
    // const ratio = this.fabricCanvas.getWidth() / this.fabricCanvas.getHeight();
    const scale = width / this.fabricCanvas.getWidth();

    const zoom = this.fabricCanvas.getZoom() * scale;

    this.fabricCanvas.setDimensions({ width: width, height: height });

    await this.fabricCanvas.setViewportTransform([zoom, 0, 0, zoom, 0, 0]);

    this.isZooming = false;
  }

  //https://codepen.io/zimm0r/pen/XBBRwb
  async rotateFabric(width: number, height: number, degree: number) {

    this.fabricCanvas.setDimensions({ width: width, height: height });
    this.fabricCanvas.getObjects().forEach((obj: any) => {
      var angleval = obj.get('angle');
      var tempDegree = angleval + degree;
      obj.set('angle', tempDegree);
      var posval = {
        top: obj.get('top'),
        left: obj.get('left')
      }

      let newleft = undefined;
      let newtop = undefined;

      if (degree == +90) {
        let tempWidth = width > height ? this.firstHeight : this.firstWidth;
        newleft = tempWidth - posval.top;
        newtop = posval.left;
      } else if (degree == -90) {
        let tempHeight = width > height ? this.firstWidth : this.firstHeight;
        newleft = posval.top;
        newtop = tempHeight - posval.left;
      }

      obj.set('top', newtop);
      obj.set('left', newleft);

      obj.setCoords();
    })
    this.isRotating = false
  }

  // 데이터를 받았는데 보고있는 페이지가 돌아가 있는 경우 다시 그려야 함
  // 페이지를 넘겼을 경우 이벤트 발생
  setCanvas() {
    let degree = this.rotation;

    // 이 위에서 한번 object들 그려주는 로직이 필요함
    this.fabricCanvas.getObjects().forEach((obj: any, index: number) => {
      // object 먼저 돌리기 
      var anglevel = obj.get('angle');
      var tempDegree = anglevel + degree;
      obj.set('angle', tempDegree)
      // 좌표 이동
      var posval = {
        top: obj.get('top'),
        left: obj.get('left')
      }

      let newLeft = 0;
      let newTop = 0;

      if (degree > 0) {
        //각도가 90, 180, 270
        let tempWidth = this.firstHeight
        let nowTop = posval.top;
        let nowLeft = posval.left;

        for (let i = degree; i > 0; i -= 90) {
          let tempLeft = nowLeft;
          nowLeft = tempWidth - nowTop;
          nowTop = tempLeft;


          if (tempWidth == this.firstWidth) tempWidth = this.firstHeight;
          else tempWidth = this.firstWidth;
        }

        newLeft = nowLeft;
        newTop = nowTop;

      } else if (degree < 0) {
        //각도가 -90, -180, -270
        let tempHeight = this.firstWidth
        let nowTop = posval.top;
        let nowLeft = posval.left;

        for (let i = degree; i < 0; i += 90) {

          let tempLeft = nowTop;
          nowTop = tempHeight - nowLeft;
          nowLeft = tempLeft;

          if (tempHeight == this.firstWidth) tempHeight = this.firstHeight;
          else tempHeight = this.firstWidth;
        }

        newLeft = nowLeft;
        newTop = nowTop;
      } else {
        newLeft = posval.left;
        newTop = posval.top
      }

      obj.set('top', newTop);
      obj.set('left', newLeft);
      obj.setCoords();
    })
  }


  // 각도가 돌아가 있어도 0도로 만든 상태로 저장하는 로직
  // 아이디어: 이렇게 번거롭게 저장하지 말고 각도를 저장해 놨다가 돌린 상태로 보여주면 되지 않을까?
  getCanvasData() {
    // 페이지 각도는 페이지가 돌아간 만큼 반대로 돌려주고 시작해야 한다
    let degree = -this.rotation;
    var json = this.fabricCanvas.toJSON();
    this.fabricCanvas.getObjects().forEach((obj: any, index: number) => {
      var angleval = obj.get('angle');
      var tempDegree = angleval + degree;
      // obj.set('angle', tempDegree);
      var posval = {
        top: obj.get('top'),
        left: obj.get('left')
      }

      let newleft = 0;
      let newtop = 0;

      if (degree > 0) {
        let tempWidth = this.fabricCanvas.width < this.fabricCanvas.height ? this.firstHeight : this.firstWidth

        let nowTop = posval.top;
        let nowLeft = posval.left;
        for (let i = degree; i > 0; i -= 90) {

          let tempLeft = nowLeft;
          nowLeft = tempWidth - nowTop;
          nowTop = tempLeft;

          if (tempWidth == this.firstWidth) tempWidth = this.firstHeight;
          else tempWidth = this.firstWidth;

        }

        newleft = nowLeft;
        newtop = nowTop;
      } else if (degree < 0) {
        let tempHeight = this.fabricCanvas.width > this.fabricCanvas.height ? this.firstHeight : this.firstWidth

        let nowTop = posval.top;
        let nowLeft = posval.left;

        for (let i = degree; i < 0; i += 90) {

          let tempLeft = nowTop;
          nowTop = tempHeight - nowLeft;
          nowLeft = tempLeft;

          if (tempHeight == this.firstWidth) tempHeight = this.firstHeight;
          else tempHeight = this.firstWidth;
        }

        newleft = nowLeft;
        newtop = nowTop;
      } else {
        newleft = posval.left
        newtop = posval.top
      }
      json.objects[index].left = newleft;
      json.objects[index].top = newtop;
      json.objects[index].angle = tempDegree;
    })
    console.log(json)
  }

  // 모드 변경
  changeMode() {
    this.dragMode = !this.dragMode;


    if (this.dragMode) this.fabricGuard.nativeElement.style.zIndex = 999;
    else this.fabricGuard.nativeElement.style.zIndex = -1;
  }

  setObject() {
    this.drawingMode = false;

    this.fabricCanvas.isDrawingMode = this.drawingMode;
  }

  // 페이지에 연필로 그리기
  setPencil() {
    this.drawingMode = true;
    this.fabricCanvas.freeDrawingBrush = new fabric_js.fabric.PencilBrush(this.fabricCanvas)
    this.fabricCanvas.isDrawingMode = this.drawingMode;
    this.fabricCanvas.freeDrawingBrush.width = 10;
    this.fabricCanvas.freeDrawingBrush.color = 'purple'

  }

  setHighlighter() {
    this.drawingMode = true;
    this.fabricCanvas.freeDrawingBrush = new fabric_js.fabric.PencilBrush(this.fabricCanvas)
    this.fabricCanvas.isDrawingMode = this.drawingMode;
    this.fabricCanvas.freeDrawingBrush.width = 10;
    this.fabricCanvas.freeDrawingBrush.color = "rgba(255,0,0,.3)";
    this.fabricCanvas.freeDrawingBrush.opacity = 0.5
  }

  // 페이지 지우개
  setEraser() {
    this.drawingMode = true;
    this.fabricCanvas.freeDrawingBrush = new fabric_js.fabric.EraserBrush(this.fabricCanvas)
    this.fabricCanvas.freeDrawingBrush.width = 10;

  }

  removeObj() {
    let activeObj = this.fabricCanvas.getActiveObject() || this.fabricCanvas.getActiveGroup();
    if (activeObj) {
      this.fabricCanvas.getActiveObjects().forEach((obj: any) => {
        this.fabricCanvas.remove(obj)
      })
      this.fabricCanvas.discardActiveObject().renderAll()
    }
  }

  // 페이지 초기화
  setClear() {

    this.fabricCanvas.clear()
  }


  // 텍스트 박스 추가
  addTextBox() {
    this.drawingMode = false;

    this.fabricCanvas.isDrawingMode = this.drawingMode;
    this.addText = true;
  }



  // ocr 라이브러리 사용 함수
  testTesseract() {

    const dataURL = this.pdfViewer.nativeElement.toDataURL();

    Tesseract.recognize(
      dataURL,
      'kor',
      // { logger: m => console.log(m) }
    ).then(({ data: { text } }) => {
      console.log(text);
    })
  }


  // naver ocr API 호출
  testNaverOCR() {
    let myText: any = [];
    let count = 0;
    // 페이지 정보 뽑아오기
    const getBlobForPage = (pageNumber: number) => {
      this.pdfDoc.getPage(pageNumber).then((page: any) => {
        const viewport = page.getViewport({ scale: 1 })
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');

        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const renderContext = {
          canvasContext: context,
          viewport: viewport
        };

        page.render(renderContext).promise.then(() => {
          canvas.toBlob((blob: Blob | null) => {
            if (blob) {

              count++;
              this.naverOcrService.postOCR(blob, '', count.toString()).subscribe((response) => {
                myText[pageNumber - 1] = response;

                console.log(count, this.pdfDoc.numPages)
                if (count == this.pdfDoc.numPages) {
                  console.log(myText)
                  this.createTxtFile(myText)
                }
              })
            }
          })
        })
      })
    }



    for (let i = 1; i <= this.pdfDoc.numPages; i++) {
      getBlobForPage(i)
    }

    // this.pdfViewer.nativeElement.toBlob((blob: any) => {
    //   this.naverOcrService.postOCR(blob)
    // })
  }

  createTxtFile(myText: Array<any>) {
    const content = myText.join('\n')

    const blob = new Blob([content], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);

    // Create a link element
    const link = document.createElement('a');
    link.href = url;
    link.download = 'example.txt';

    // Append the link to the document body
    document.body.appendChild(link);

    // Trigger the download
    link.click();

    // Clean up
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }




  searchData() {
    const input: any = document.getElementById('searchInput');
    console.log(input.value)

    this.docService.searchDocData(input.value).subscribe((res: any) => {
      console.log(res)
    })
  }
}
