import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { map } from 'rxjs';
@Injectable({
  providedIn: 'root'
})
export class NaverOcrService {

  constructor(private http: HttpClient) { }

  postOCR(jsonData: any, title: string, page: string) {
    const url = 'http://localhost:3200/api/test'

    const docData = new FormData();
    docData.append('file', jsonData)
    docData.append('title', '제10기 제 3회차 이사회 회의자료')
    docData.append('page', page)
    return this.http.post(url, docData).pipe(map((data: any) => {
      let text = '';
      for (let i of data[0]['fields']) {
        text += i['inferText'] + ' ';
      }

      return text;
    }))
  }


}